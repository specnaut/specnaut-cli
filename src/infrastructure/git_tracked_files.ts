import { join } from "@std/path";
import type {
  FileRead,
  LockEntries,
  ReadRequest,
  ScanRepository,
  TrackedListing,
} from "../application/structural_scan_ports.ts";
import { LOCK_PATH } from "../application/structural_scan_ports.ts";
import { SIZE_LIMITS_CONFIG_PATH } from "../domain/constitution_paths.ts";
import { parseLock } from "../domain/installed_lock.ts";
import { type SizeConfig, sizeConfigFromEntry } from "../domain/size_limits.ts";
import { readAdmitted } from "./bounded_file_read.ts";
import { NAME, parseStage } from "./git_stage_listing.ts";
import { resolveProjectRoot } from "./fs_containment.ts";
import { DenoFsReader } from "./fs_reader.ts";

/**
 * Reads an unvetted repository safely (plan § 5): the one home of how git runs against it, of
 * whether a tracked path may be opened, and of where its root is.
 *
 * "Read-only" git still runs programs a repository names: a plain `git ls-files` spawns whatever
 * `core.fsmonitor` says (probed 2026-11-05). So every call turns that off, takes pathspecs
 * literally, asks for no optional lock, and is one of three subcommands; `safe.directory` is never
 * passed, so a refusal stays a refusal.
 */

/** The repository cannot be scanned at all: no work tree, no git, a refused root. Exit 3. */
class ScanRefused extends Error {}

const GIT = [
  "--no-pager",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotePath=false",
];
type Subcommand = "rev-parse" | "ls-files" | "check-attr";

async function git(cwd: string, sub: Subcommand, args: string[], input?: Uint8Array) {
  const child = spawnGit(cwd, [...GIT, sub, ...args], input !== undefined);
  const [out] = await Promise.all([child.output(), input && writeAll(child.stdin, input)]);
  if (out.success) return out.stdout;
  const why = new TextDecoder().decode(out.stderr).trim().split("\n")[0].slice(0, 300);
  throw new ScanRefused(`git ${sub} failed: ${why || `exit ${out.code}`}`);
}

/** The one spawn of git in the scan, with no optional lock taken. */
function spawnGit(cwd: string, args: string[], piped: boolean): Deno.ChildProcess {
  const stdin = piped ? "piped" : "null";
  const env = { GIT_OPTIONAL_LOCKS: "0" };
  const out = "piped";
  const command = new Deno.Command("git", { args, cwd, env, stdin, stdout: out, stderr: out });
  try {
    return command.spawn();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new ScanRefused("git is not on the PATH");
    throw err;
  }
}

async function writeAll(stream: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(bytes);
  await writer.close();
}

/**
 * The repository `cwd` is in, rooted at git's top level and never at `cwd`: run from a
 * subdirectory, the scan reads the same config and reports the same paths (plan A7). `.git` must
 * be right under that top level, so a `core.worktree` pointing elsewhere is refused, and the root
 * is never the filesystem root or the home directory.
 */
export async function openGitRepository(
  cwd: string,
  warn: (message: string) => void = () => {},
): Promise<GitTrackedFiles> {
  const out = await git(cwd, "rev-parse", ["--show-toplevel"]);
  let top: string;
  try {
    top = NAME.decode(out).replace(/\r?\n$/, "");
  } catch (err) {
    throw new ScanRefused(`the work tree's path is not valid UTF-8 (${err})`);
  }
  try {
    await Deno.lstat(join(top, ".git"));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    throw new ScanRefused("no .git directly under the work tree's top level");
  }
  return new GitTrackedFiles(await resolveProjectRoot(top), warn);
}

/** An entry naming no file under the root, which git lists from a planted index but never writes. */
const OUTSIDE_ROOT = /(?:^|\/)\.{0,2}(?:\/|$)|\\|^[A-Za-z]:/;

type Admission = "ok" | "link" | "missing" | "unreadable";

export class GitTrackedFiles implements ScanRepository {
  readonly #folders = new Map<string, Promise<Admission>>();
  readonly #reader = new DenoFsReader();

  constructor(readonly root: string, private readonly warn: (message: string) => void = () => {}) {}

  async sizeConfig(): Promise<SizeConfig> {
    return sizeConfigFromEntry(await this.#reader.readEntry(this.root, SIZE_LIMITS_CONFIG_PATH));
  }

  /** The lock as `lstat` sees it: a link or bytes that are not UTF-8 are unreadable, never followed. */
  async lockEntries(): Promise<LockEntries> {
    const entry = await this.#reader.readEntry(this.root, LOCK_PATH);
    if (entry === null) return { kind: "ok", paths: new Set() };
    if (entry.kind === "symlink") return { kind: "unreadable", reason: "is a link" };
    if (entry.lossy) return { kind: "unreadable", reason: "is not valid UTF-8" };
    try {
      return { kind: "ok", paths: new Set(parseLock(entry.content).entries.keys()) };
    } catch (err) {
      return { kind: "unreadable", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async listTracked(path: string | null): Promise<TrackedListing> {
    const scope = path === null ? [] : ["--", path];
    return parseStage(await git(this.root, "ls-files", ["-z", "--stage", ...scope]));
  }

  /** A path outside the root is never asked about: git refuses the whole call over one. */
  async diffAttributes(all: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const paths = all.filter((p) => !OUTSIDE_ROOT.test(p));
    if (paths.length === 0) return new Map();
    const input = new TextEncoder().encode(paths.join("\0") + "\0");
    const out = await git(this.root, "check-attr", ["-z", "--stdin", "diff"], input);
    // Lossy: the paths are the ones sent, and a value not UTF-8 is a driver name, never `unset`.
    const fields = new TextDecoder().decode(out).split("\0");
    const attributes = new Map<string, string>();
    for (let i = 0; i + 2 < fields.length; i += 3) attributes.set(fields[i], fields[i + 2]);
    return attributes;
  }

  /**
   * One tracked path, admitted by what the disk says, whatever the index says (plan S3): every
   * folder above it a real folder, never a link, and the path itself a regular file. Anything else
   * is skipped with its reason, never thrown, and never opened.
   */
  async read(path: string, request: ReadRequest): Promise<FileRead> {
    if (OUTSIDE_ROOT.test(path)) return { kind: "skipped", reason: "outside_root" };
    const above = await this.#folder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
    if (above !== "ok") return admissionRead(above);
    const abs = join(this.root, path);
    try {
      const info = await Deno.lstat(abs);
      if (info.isSymlink) return { kind: "skipped", reason: "symlink" };
      if (!info.isFile) return { kind: "skipped", reason: "not_regular" };
      return await readAdmitted(abs, info.size, request);
    } catch (err) {
      return admissionRead(this.#failure(path, err));
    }
  }

  /** Whether the folder `dir` is a real folder all the way up, each folder asked once. */
  #folder(dir: string): Promise<Admission> {
    if (dir === "") return Promise.resolve("ok");
    let known = this.#folders.get(dir);
    if (known === undefined) {
      known = this.#folder(dir.slice(0, Math.max(0, dir.lastIndexOf("/")))).then((parent) =>
        parent === "ok" ? this.#lstatFolder(dir) : parent
      );
      this.#folders.set(dir, known);
    }
    return known;
  }

  async #lstatFolder(dir: string): Promise<Admission> {
    try {
      const info = await Deno.lstat(join(this.root, dir));
      return info.isSymlink ? "link" : info.isDirectory ? "ok" : "missing";
    } catch (err) {
      return this.#failure(dir, err);
    }
  }

  /** An OS error on one path: absent, or unreadable and said so. The process's own denial throws. */
  #failure(path: string, err: unknown): Exclude<Admission, "ok"> {
    if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotADirectory) {
      return "missing";
    }
    if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
    this.warn(`cannot read ${path}: ${err.message}`);
    return "unreadable";
  }
}

function admissionRead(a: Exclude<Admission, "ok">): FileRead {
  if (a === "missing") return { kind: "missing" };
  return { kind: "skipped", reason: a === "link" ? "link_ancestor" : "unreadable" };
}
