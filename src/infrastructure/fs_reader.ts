import { join, relative, SEPARATOR } from "@std/path";
import type { FsReader } from "../application/ports.ts";
import { assertSafeDestination } from "../domain/template.ts";
import type { DiskEntry } from "../domain/context_link.ts";
import { UnwalkableLinkError } from "./fs_link_walk.ts";
import {
  assertInsideProject,
  assertRemovableInProject,
  resolveProjectRoot,
  resolveTarget,
  UnwalkableRefusal,
} from "./fs_containment.ts";

export class DenoFsReader implements FsReader {
  /**
   * Reads a project-relative file, or `null` when it is not there.
   *
   * Guarded on both axes since cli#574, because before that it was guarded on
   * neither — three lines with no validator of any kind, and the only `FsReader`
   * implementation. What made that matter is where the bytes go: a bundle
   * destination symlinked to a file outside the project made `specnaut diff`
   * render that file's contents as a unified diff on stdout. Measured with the
   * real binary. The severity argument used for the write escapes — a hostile
   * repository can already run code — does not cover this one, because this
   * CLI's stdout is routinely read into a coding agent's context and into CI
   * logs, so "prints to the terminal" is not a local outcome.
   *
   * `rel` is not always a bundle destination this binary wrote: `upgrade` reads
   * every key in `.specnaut/installed.lock`, and that file is committed and not
   * covered by the scaffolded `.gitignore`, so a cloned repository supplies it.
   * The string check is therefore not redundant with the callers.
   */
  async readText(projectDir: string, rel: string): Promise<string | null> {
    assertSafeDestination(rel);
    const abs = join(projectDir, rel);
    const root = await existingRoot(projectDir);
    if (root === null || !await guarded(assertInsideProject(root, abs))) return null;
    try {
      return await Deno.readTextFile(abs);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  /**
   * What is at `rel` itself (cli#680): a link is reported with its text and
   * where it lands, never read through — reading through `.claude/CLAUDE.md`
   * reads `AGENTS.md`, and through a foreign link pointing out of the project
   * it would read, or refuse, a file that is none of this project's business.
   *
   * Guarded as a removal is (the leaf as is, ancestors resolved), because the
   * only content this returns is a regular file's, at the very path judged.
   */
  async readEntry(projectDir: string, rel: string): Promise<DiskEntry | null> {
    assertSafeDestination(rel);
    const root = await existingRoot(projectDir);
    const abs = join(projectDir, rel);
    if (root === null || !await guarded(assertRemovableInProject(root, abs))) return null;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(abs);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    if (!info.isSymlink) return fileEntry(await Deno.readFile(abs));
    const target = await Deno.readLink(abs);
    let resolved: string | null;
    try {
      resolved = relative(root, await resolveTarget(abs)).split(SEPARATOR).join("/");
    } catch (err) {
      // A cycle, or a link through a directory that does not exist, cannot be
      // followed; say so with `null` rather than guess.
      if (!(err instanceof Deno.errors.FilesystemLoop || err instanceof UnwalkableLinkError)) {
        throw err;
      }
      resolved = null;
    }
    return { kind: "symlink", target, resolved };
  }
}

/**
 * A regular file's entry, its text decoded as `Deno.readTextFile` does (a BOM
 * kept, an invalid sequence replaced), so every caller judges the same text it
 * always has. What a decode cannot say is whether that text IS the file, and an
 * upgrade that moves a file writes the text and deletes the bytes: so the round
 * trip is proved here, where the bytes are, and a file that fails it is marked
 * `lossy` rather than refused — reading it is still fine, moving it is not.
 */
function fileEntry(bytes: Uint8Array): DiskEntry {
  const content = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const back = new TextEncoder().encode(content);
  const exact = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
  return exact ? { kind: "file", content } : { kind: "file", content, lossy: true };
}

/**
 * The project root, or `null` when the directory does not exist yet. Nothing
 * is at any path under a directory that is not there — a greenfield `init`,
 * and its `--dry-run` that creates nothing, read before the first write — so
 * that is absence, said here once instead of each caller swallowing the throw.
 * A root that exists and is refused (the filesystem root, the home directory)
 * or cannot be resolved for another reason still throws.
 */
async function existingRoot(projectDir: string): Promise<string | null> {
  try {
    return await resolveProjectRoot(projectDir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/**
 * Runs a containment check for a READ. A link through a directory that does not
 * exist has nothing to read, so a reader reports it as absent (`false`) where a
 * writer refuses (cli#686) — `diff` must not abort over the user's dangling
 * link. Every other refusal still throws.
 */
async function guarded(check: Promise<void>): Promise<boolean> {
  try {
    await check;
    return true;
  } catch (err) {
    if (err instanceof UnwalkableRefusal) return false;
    throw err;
  }
}
