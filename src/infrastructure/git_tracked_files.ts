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
import { GitRefused, UntrustedGit } from "./untrusted_git.ts";

/**
 * Reads an unvetted repository safely: the one home of whether a tracked path may be
 * opened, and of where its root is. How git runs against it is `untrusted_git.ts`'s; the scan asks
 * it three subcommands, `rev-parse`, `ls-files` and `check-attr`.
 */

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
  const out = await new UntrustedGit(cwd).run("rev-parse", ["--show-toplevel"]);
  let top: string;
  try {
    top = NAME.decode(out).replace(/\r?\n$/, "");
  } catch (err) {
    throw new GitRefused(`the work tree's path is not valid UTF-8 (${err})`);
  }
  try {
    await Deno.lstat(join(top, ".git"));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    throw new GitRefused("no .git directly under the work tree's top level");
  }
  return new GitTrackedFiles(await resolveProjectRoot(top), warn);
}

/** An entry naming no file under the root, which git lists from a planted index but never writes. */
const OUTSIDE_ROOT = /(?:^|\/)\.{0,2}(?:\/|$)|\\|^[A-Za-z]:/;

type Admission = "ok" | "link" | "missing" | "unreadable";

export class GitTrackedFiles implements ScanRepository {
  readonly #folders = new Map<string, Promise<Admission>>();
  readonly #reader = new DenoFsReader();
  readonly #git: UntrustedGit;

  constructor(readonly root: string, private readonly warn: (message: string) => void = () => {}) {
    this.#git = new UntrustedGit(root);
  }

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
    return parseStage(await this.#git.run("ls-files", ["-z", "--stage", ...scope]));
  }

  /** A path outside the root is never asked about: git refuses the whole call over one. */
  async diffAttributes(all: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const paths = all.filter((p) => !OUTSIDE_ROOT.test(p));
    if (paths.length === 0) return new Map();
    const input = new TextEncoder().encode(paths.join("\0") + "\0");
    const out = await this.#git.run("check-attr", ["-z", "--stdin", "diff"], input);
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
