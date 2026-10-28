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
    if (!await guarded(assertInsideProject(await resolveProjectRoot(projectDir), abs))) return null;
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
    const root = await resolveProjectRoot(projectDir);
    const abs = join(projectDir, rel);
    if (!await guarded(assertRemovableInProject(root, abs))) return null;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(abs);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    if (!info.isSymlink) return { kind: "file", content: await Deno.readTextFile(abs) };
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
