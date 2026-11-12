import { join } from "@std/path";
import { type CheckoutTreeWalker, MAX_SCRIPT_BYTES } from "../application/script_trust_ports.ts";
import { inScopeRoot, type ScopeRoot } from "../domain/checkout_scope.ts";
import { REASON, type TreeEntry, type TreeWalk } from "../domain/script_trust.ts";

/**
 * Walks a folder as the disk holds it: every folder from the project's root down is `lstat`ed, so
 * a link on the way stops the walk; a link inside is recorded with its target, never followed; dot
 * files are walked like any other. A file's bytes are read from the descriptor it was checked on,
 * and only for a file the root takes: a shallow root lists its folder and reads nothing else.
 *
 * Its limit on Windows: Deno reports no `ino` and no `nlink` there, so a hard link reads as linked
 * once (`links` is 1, and the trust rule's hard-link check never fires) and the descriptor check
 * compares the device alone. Both checks hold on POSIX only.
 */
export class FsTreeWalker implements CheckoutTreeWalker {
  constructor(private readonly root: string) {}

  async walk(scope: ScopeRoot): Promise<TreeWalk> {
    const parts = scope.dir === "." ? [] : scope.dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const info = await lstatOrNull(join(this.root, path));
      if (info === null) return { kind: "walked", entries: [] };
      if (info.isSymlink) return { kind: "blocked", path, why: REASON.link };
      if (!info.isDirectory) return { kind: "blocked", path, why: "not a folder" };
    }
    const entries: TreeEntry[] = [];
    await this.#walkDir(parts.join("/"), scope, entries);
    return { kind: "walked", entries: entries.sort((a, b) => a.path < b.path ? -1 : 1) };
  }

  async #walkDir(dir: string, scope: ScopeRoot, into: TreeEntry[]): Promise<void> {
    for await (const item of Deno.readDir(join(this.root, dir || "."))) {
      const path = dir === "" ? item.name : `${dir}/${item.name}`;
      try {
        const info = await Deno.lstat(join(this.root, path));
        if (info.isDirectory) {
          if (!scope.deep) continue;
          // A nested repository (a worktree, a clone) is one foreign entry: its files are not read.
          if (await lstatOrNull(join(this.root, path, ".git")) !== null) {
            into.push({ kind: "other", path });
          } else await this.#walkDir(path, scope, into);
        } else if (!inScopeRoot(scope, path)) continue;
        else if (info.isSymlink) {
          into.push({ kind: "link", path, target: await Deno.readLink(join(this.root, path)) });
        } else if (info.isFile) into.push(await readChecked(join(this.root, path), path, info));
        else into.push({ kind: "other", path });
      } catch (err) {
        if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
        into.push({ kind: "unreadable", path, why: err.message });
      }
    }
  }
}

/** The bytes of the file `lstat` saw, read from one descriptor that is still that file. */
async function readChecked(abs: string, path: string, seen: Deno.FileInfo): Promise<TreeEntry> {
  const file = await Deno.open(abs, { read: true });
  try {
    const info = await file.stat();
    if (!info.isFile || info.ino !== seen.ino || info.dev !== seen.dev) {
      return { kind: "unreadable", path, why: "changed while it was read" };
    }
    // The size `fstat` reports bounds the read; a file growing under it is a race, not a mistake.
    if (info.size > MAX_SCRIPT_BYTES) {
      return { kind: "unreadable", path, why: `over ${MAX_SCRIPT_BYTES} bytes` };
    }
    return { kind: "file", path, bytes: await readAll(file), links: info.nlink ?? 1 };
  } finally {
    file.close();
  }
}

async function readAll(file: Deno.FsFile): Promise<Uint8Array> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const buf = new Uint8Array(64 * 1024);
  for (let n = await file.read(buf); n !== null; n = await file.read(buf)) {
    chunks.push(buf.slice(0, n));
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

async function lstatOrNull(abs: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(abs);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
