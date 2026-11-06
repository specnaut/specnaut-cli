import { join } from "@std/path";
import type { ScriptTreeWalker } from "../application/script_trust_ports.ts";
import { REASON, SCRIPTS_DIR, type TreeEntry, type TreeWalk } from "../domain/script_trust.ts";

/**
 * Walks `.specnaut/scripts/` as the disk holds it: every folder from the project's root down is
 * `lstat`ed, so a link on the way stops the walk; a link inside is recorded, never followed; dot
 * files are walked like any other. A file's bytes are read from the descriptor it was checked on.
 */
export class FsScriptTreeWalker implements ScriptTreeWalker {
  constructor(private readonly root: string) {}

  async walk(): Promise<TreeWalk> {
    const parts = SCRIPTS_DIR.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const info = await lstatOrNull(join(this.root, path));
      if (info === null) return { kind: "walked", entries: [] };
      if (info.isSymlink) return { kind: "blocked", path, why: REASON.link };
      if (!info.isDirectory) return { kind: "blocked", path, why: "not a folder" };
    }
    const entries: TreeEntry[] = [];
    await this.#walkDir(SCRIPTS_DIR, entries);
    return { kind: "walked", entries: entries.sort((a, b) => a.path < b.path ? -1 : 1) };
  }

  async #walkDir(dir: string, into: TreeEntry[]): Promise<void> {
    for await (const item of Deno.readDir(join(this.root, dir))) {
      const path = `${dir}/${item.name}`;
      try {
        const info = await Deno.lstat(join(this.root, path));
        if (info.isSymlink) into.push({ kind: "link", path });
        else if (info.isDirectory) await this.#walkDir(path, into);
        else if (info.isFile) into.push(await readChecked(join(this.root, path), path, info));
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
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const buf = new Uint8Array(64 * 1024);
    for (let n = await file.read(buf); n !== null; n = await file.read(buf)) {
      chunks.push(buf.slice(0, n));
    }
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    return { kind: "file", path, bytes, links: info.nlink ?? 1 };
  } finally {
    file.close();
  }
}

async function lstatOrNull(abs: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(abs);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
