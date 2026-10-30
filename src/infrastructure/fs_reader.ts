import { join, relative, SEPARATOR } from "@std/path";
import type { FsReader } from "../application/ports.ts";
import { assertSafeDestination } from "../domain/template.ts";
import type { DiskEntry } from "../domain/context_link.ts";
import { ReadFault } from "../application/read_fault.ts";
import {
  admit,
  admitRemoval,
  type Containment,
  locate,
  resolveProjectRoot,
} from "./fs_containment.ts";

/** `\` separates path segments in a link's text here (see `DiskEntry`). */
const WINDOWS = Deno.build.os === "windows";

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
    if (root === null || !readable(root, abs, await locate(root, abs, "target"))) return null;
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
    try {
      if (root === null) return null;
      if (!readable(root, abs, await locate(root, abs, "entry"), admitRemoval)) return null;
      return await entryOf(root, abs);
    } catch (err) {
      throw asReadFault(err);
    }
  }

  /** See `listProjectFiles`, the one walker of a project folder. */
  listFiles(projectDir: string, rel: string): Promise<string[]> {
    return listProjectFiles(projectDir, rel);
  }
}

/**
 * The filesystem's own error — a permission, an I/O fault — as the `ReadFault`
 * the port promises (cli#704); a containment refusal, or anything else, as is.
 */
function asReadFault(err: unknown): unknown {
  const os = Object.values(Deno.errors).some((c) => err instanceof c);
  return os ? new ReadFault((err as Error).message, { cause: err }) : err;
}

/** `readEntry` past its containment check: what `lstat` sees at `abs`. */
async function entryOf(root: string, abs: string): Promise<DiskEntry | null> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(abs);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  if (!info.isSymlink) return fileEntry(await Deno.readFile(abs));
  const target = await Deno.readLink(abs);
  // A link that cannot be followed says so with `null` rather than guess.
  const verdict = await followed(root, abs);
  const resolved = verdict === null || !("resolved" in verdict)
    ? null
    : relative(root, verdict.resolved).split(SEPARATOR).join("/");
  return { kind: "symlink", target, resolved, ...(WINDOWS ? { windows: true as const } : {}) };
}

/**
 * The files under the folder `rel`, sorted, as project-relative `/` paths — the
 * one walker of a project folder: `listFiles` is this, and so is the doctor's
 * addenda check, so the notice that reads an addendum and the check that warns
 * about it cannot disagree about which files exist (cli#712; they did, about
 * links).
 *
 * The folder is judged as a read is: every link on the way to it resolved, and
 * inside the project. Below it a link counts as a file only when it lands on a
 * regular file inside the project, which `readText` then reads under the same
 * check. A link that leaves the project, dangles or loops is not listed, so
 * nothing listed can lead outside. A linked folder is never descended into, so
 * a link back up the tree cannot walk forever; the cost, and the one blind spot
 * left, is a file reached only through a linked folder, which is not listed.
 */
export async function listProjectFiles(projectDir: string, rel: string): Promise<string[]> {
  assertSafeDestination(rel);
  const root = await existingRoot(projectDir);
  const abs = join(projectDir, rel);
  if (root === null || !readable(root, abs, await locate(root, abs, "target"))) return [];
  try {
    if (!(await Deno.stat(abs)).isDirectory) return [];
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const path = join(dir, e.name);
      if (e.isDirectory) await walk(path, `${prefix}/${e.name}`);
      else if (e.isFile || (e.isSymlink && await landsOnFileInside(root, path))) {
        found.push(`${prefix}/${e.name}`);
      }
    }
  };
  await walk(abs, rel);
  return found.sort();
}

/**
 * Where following the link at `abs` lands, as containment tags it — or `null`
 * for a link through a regular file, the filesystem's own `NotADirectory`,
 * which is no containment verdict. A link that cannot be followed is that
 * `null`, an `unwalkable` or a `loop`: the one home of that set (cli#704).
 */
async function followed(root: string, abs: string): Promise<Containment | null> {
  try {
    return await locate(root, abs, "target");
  } catch (err) {
    if (err instanceof Deno.errors.NotADirectory) return null;
    throw err;
  }
}

/**
 * Whether the link at `abs` lands on a regular file inside `root`. A link that
 * cannot be followed lands nowhere (`followed`): for a listing that means
 * "not a file", not a refusal, so the user's broken link does not abort a walk
 * that reads nothing through it.
 */
async function landsOnFileInside(root: string, abs: string): Promise<boolean> {
  const verdict = await followed(root, abs);
  if (verdict?.kind !== "inside") return false;
  try {
    return (await Deno.stat(verdict.resolved)).isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
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
 * A READ's answer to a containment verdict. A link through a directory that
 * does not exist has nothing to read, so a reader reports it as absent
 * (`false`) where a writer refuses (cli#686) — `diff` must not abort over the
 * user's dangling link. Every other verdict but `inside` is refused by `admit`
 * (or `admitRemoval`, for the entry itself), exactly as a writer refuses it.
 */
function readable(
  root: string,
  abs: string,
  verdict: Containment,
  refuse: (root: string, abs: string, verdict: Containment) => void = admit,
): boolean {
  if (verdict.kind === "unwalkable") return false;
  refuse(root, abs, verdict);
  return true;
}
