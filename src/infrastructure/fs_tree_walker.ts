import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import { type CheckoutTreeWalker, MAX_SCRIPT_BYTES } from "../application/script_trust_ports.ts";
import { inScopeRoot, type ScopeRoot } from "../domain/checkout_scope.ts";
import type { LinkEnd } from "../domain/checkout_link.ts";
import type { CheckoutEntry, CheckoutWalk } from "../domain/checkout_trust.ts";
import { REASON } from "../domain/script_trust.ts";

/**
 * Walks a folder as the disk holds it: every folder from the project's root down is `lstat`ed, so
 * a link on the way stops the walk; a link inside is recorded with its target and where it leads,
 * never followed; dot files are walked like any other. A file's bytes are read from the descriptor
 * it was checked on, and only for a file the root takes: a shallow root lists its folder and reads
 * nothing else. A deep root that is itself a link is one link entry when `rootLinks` is `"entry"`,
 * so it can be judged as the base's own link; with `"block"` it stops the walk like any other.
 *
 * Its limit on Windows: Deno reports no `ino` and no `nlink` there, so a hard link reads as linked
 * once (`links` is 1, and the trust rule's hard-link check never fires), the descriptor check
 * compares the device alone, and a file has no identity for a link to be matched against. These
 * checks hold on POSIX only.
 */
export class FsTreeWalker implements CheckoutTreeWalker {
  #realRoot: Promise<string> | undefined;

  constructor(
    private readonly root: string,
    private readonly rootLinks: "entry" | "block" = "entry",
  ) {}

  async walk(scope: ScopeRoot): Promise<CheckoutWalk> {
    const parts = scope.dir === "." ? [] : scope.dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const info = await lstatOrNull(join(this.root, path));
      if (info === null) return { kind: "walked", entries: [] };
      const last = i === parts.length && scope.deep && this.rootLinks === "entry";
      if (info.isSymlink && last) return { kind: "walked", entries: [await this.#link(path)] };
      if (info.isSymlink) return { kind: "blocked", path, why: REASON.link };
      if (!info.isDirectory) return { kind: "blocked", path, why: "not a folder" };
    }
    const entries: CheckoutEntry[] = [];
    await this.#walkDir(parts.join("/"), scope, entries);
    return { kind: "walked", entries: entries.sort((a, b) => a.path < b.path ? -1 : 1) };
  }

  async #walkDir(dir: string, scope: ScopeRoot, into: CheckoutEntry[]): Promise<void> {
    for await (const item of Deno.readDir(join(this.root, dir || "."))) {
      const path = dir === "" ? item.name : `${dir}/${item.name}`;
      try {
        await this.#visit(path, scope, into);
      } catch (err) {
        if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
        into.push({ kind: "unreadable", path, why: err.message });
      }
    }
  }

  /** One entry: a folder walked (deep roots only), anything else the root takes recorded. */
  async #visit(path: string, scope: ScopeRoot, into: CheckoutEntry[]): Promise<void> {
    const abs = join(this.root, path);
    const info = await Deno.lstat(abs);
    if (info.isDirectory) {
      if (!scope.deep) return;
      // A nested repository (a worktree, a clone) is one foreign entry: its files are not read.
      if (await lstatOrNull(join(abs, ".git")) !== null) into.push({ kind: "other", path });
      else await this.#walkDir(path, scope, into);
    } else if (!inScopeRoot(scope, path)) return;
    else if (info.isSymlink) into.push(await this.#link(path));
    else if (info.isFile) into.push(await readChecked(abs, path, info));
    else into.push({ kind: "other", path });
  }

  /** A link: its target as written (forward slashes on Windows), and where it leads on disk. */
  async #link(path: string): Promise<CheckoutEntry> {
    const abs = join(this.root, path);
    const target = asWritten(await Deno.readLink(abs), Deno.build.os);
    return { kind: "link", path, target, end: await this.#end(abs) };
  }

  async #end(abs: string): Promise<LinkEnd> {
    try {
      const real = await Deno.realPath(abs);
      const rel = relative(await (this.#realRoot ??= Deno.realPath(this.root)), real);
      if (rel === ".." || rel.startsWith(`..${SEPARATOR}`) || isAbsolute(rel)) {
        return { kind: "outside" };
      }
      const path = rel.replaceAll(SEPARATOR, "/");
      return { kind: "inside", path, id: fileId(await Deno.stat(real)) };
    } catch (err) {
      if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
      return { kind: "unresolved", why: err.message };
    }
  }
}

/**
 * A link's target as git writes it: Windows reads it back with backslashes, which git stores as
 * forward slashes. Elsewhere a backslash is a character of the name, and the check refuses it.
 */
export function asWritten(target: string, os: typeof Deno.build.os): string {
  return os === "windows" ? target.replaceAll("\\", "/") : target;
}

/** A file's identity on its device, or `null` where the platform reports none. */
function fileId(info: Deno.FileInfo): string | null {
  return info.dev === null || info.ino === null ? null : `${info.dev}:${info.ino}`;
}

/** The bytes of the file `lstat` saw, read from one descriptor that is still that file. */
async function readChecked(abs: string, path: string, seen: Deno.FileInfo): Promise<CheckoutEntry> {
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
    const bytes = await readAll(file);
    return { kind: "file", path, bytes, links: info.nlink ?? 1, id: fileId(info) };
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
