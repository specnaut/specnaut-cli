import { dirname, isAbsolute, join, relative, SEPARATOR } from "@std/path";
import {
  type ExportHome,
  ExportRefused,
  type ExportStore,
  type TreeObjects,
} from "../application/untrusted_review_ports.ts";
import { isCommitSha } from "../domain/branch_source.ts";
import { formatOf, gitBlobId } from "../domain/git_object_id.ts";
import type { ExportPlan, PlannedFile } from "../domain/tree_plan.ts";
import { isInside } from "../domain/template.ts";
import { armExitTrap } from "./exit_trap.ts";
import { securePrivateFolder } from "./private_folder.ts";

/**
 * The export's folders: `<cache>/specnaut/untrusted/<sha>/` holding `git/` (the borrowed
 * repository), `seats/` and `scratch/`. Outside the project, so no harness started there finds a
 * file of the export by walking its folder; and every file and folder is created new by this
 * module, so no write can land through a link or onto something already there.
 */

/** The user's cache folder, as each platform names it, then `specnaut/untrusted`. */
export function exportCacheRoot(os: string, env: (name: string) => string | undefined): string {
  const xdg = env("XDG_CACHE_HOME");
  const home = env("HOME") ?? env("USERPROFILE") ?? "";
  const cache = xdg !== undefined && isAbsolute(xdg)
    ? xdg
    : os === "darwin"
    ? join(home, "Library", "Caches")
    : os === "windows"
    ? env("LOCALAPPDATA") ?? join(home, "AppData", "Local")
    : join(home, ".cache");
  if (!isAbsolute(cache)) throw new ExportRefused("no cache folder: set XDG_CACHE_HOME or HOME");
  return join(cache, "specnaut", "untrusted");
}

/** How many blobs one `cat-file --batch` reads: the byte cap bounds the total, this the step. */
const BLOB_BATCH = 256;
const windows = Deno.build.os === "windows";

export class FsExportStore implements ExportStore {
  readonly #made: string[] = [];
  #root: string | undefined;
  #home: ExportHome | undefined;
  #disarm: (() => void) | undefined;

  constructor(readonly projectDir: string, readonly cacheRoot: string) {}

  async stage(): Promise<string> {
    await Deno.mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const root = await Deno.realPath(this.cacheRoot);
    const project = await Deno.realPath(this.projectDir);
    if (isInside(project, root)) {
      throw new ExportRefused(`the cache folder ${root} is inside the project; set XDG_CACHE_HOME`);
    }
    await securePrivateFolder(root);
    this.#root = root;
    this.#disarm ??= armExitTrap(() => this.#removeSync());
    const staging = await Deno.makeTempDir({ dir: root, prefix: ".fetch-" });
    this.#made.push(staging);
    return join(staging, "git");
  }

  async claim(sha: string, staged: string): Promise<ExportHome> {
    if (!isCommitSha(sha)) throw new ExportRefused("not a full commit id");
    const staging = dirname(staged);
    if (!this.#made.includes(staging)) throw new Error("claim takes the path stage handed out");
    // The staging check above proves `stage` ran, so the root it resolved is set.
    const root = join(this.#root!, sha);
    // A folder left by an export that could not clean up is not trusted to be what it was.
    await Deno.remove(root, { recursive: true }).catch(ignoreNotFound);
    await Deno.mkdir(root, { mode: 0o700 });
    this.#made.push(root);
    const home = { root, gitDir: join(root, "git"), seats: join(root, "seats") };
    this.#home = { ...home, scratch: join(root, "scratch") };
    await this.#adopt(staged, home.gitDir);
    await Deno.mkdir(this.#home.seats);
    await Deno.mkdir(this.#home.scratch);
    return this.#home;
  }

  /** Moves the staged repository into the export, and drops the staging folder it leaves. */
  async #adopt(staged: string, gitDir: string): Promise<void> {
    await Deno.rename(staged, gitDir);
    const staging = dirname(staged);
    await Deno.remove(staging);
    this.#made.splice(this.#made.indexOf(staging), 1);
  }

  async write(plan: ExportPlan, objects: TreeObjects): Promise<void> {
    const home = this.#claimed();
    const made = new Set([home.seats, home.scratch]);
    for (let i = 0; i < plan.files.length; i += BLOB_BATCH) {
      const batch = plan.files.slice(i, i + BLOB_BATCH);
      const blobs = await objects.readBlobs([...new Set(batch.map((f) => f.sha))]);
      for (const file of batch) {
        const bytes = blobs.get(file.sha)!;
        await writeNew(home.seats, file, bytes, 0o644, made);
        await writeNew(home.scratch, file, bytes, file.executable ? 0o755 : 0o644, made);
      }
    }
  }

  async verify(plan: ExportPlan): Promise<void> {
    const home = this.#claimed();
    const expected = new Map(plan.files.map((f) => [join(home.seats, ...f.names), f]));
    const found = await walkFiles(home.seats);
    for (const path of found) {
      const file = expected.get(path);
      if (file === undefined) throw new ExportRefused(`${path} was not written by the export`);
      const bytes = await Deno.readFile(path);
      if (await gitBlobId(bytes, formatOf(file.sha)) !== file.sha) {
        throw new ExportRefused(`${path} differs from the commit`);
      }
      if (!windows && ((await Deno.lstat(path)).mode! & 0o777) !== 0o644) {
        throw new ExportRefused(`${path} is not mode 0644`);
      }
    }
    if (found.length !== expected.size) throw new ExportRefused("a planned file is missing");
  }

  async remove(): Promise<void> {
    for (const path of this.#made.splice(0).reverse()) {
      await Deno.remove(path, { recursive: true }).catch(ignoreNotFound);
    }
    this.#disarm?.();
    this.#disarm = undefined;
  }

  /** The trap's cleanup: synchronous, since `unload` waits for nothing. */
  #removeSync(): void {
    for (const path of this.#made.splice(0).reverse()) {
      try {
        Deno.removeSync(path, { recursive: true });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          console.error(`warning: could not remove ${path}: ${(err as Error).message}`);
        }
      }
    }
  }

  #claimed(): ExportHome {
    if (this.#home === undefined) throw new Error("the export has no home yet: claim it first");
    return this.#home;
  }
}

/**
 * Writes one planned file under `base`: the path must stay strictly inside it, each folder on the
 * way is made new (a `mkdir` that is not recursive fails on anything already there, a link
 * included), and the file is created new, so it cannot open what a link points at.
 */
async function writeNew(
  base: string,
  file: PlannedFile,
  bytes: Uint8Array,
  mode: number,
  made: Set<string>,
): Promise<void> {
  const abs = join(base, ...file.names);
  const rel = relative(base, abs);
  if (rel === "" || !isInside(base, abs) || rel.split(SEPARATOR).length !== file.names.length) {
    throw new ExportRefused(`${file.path} resolves outside the export`);
  }
  await makeParents(base, abs, made);
  const out = await Deno.open(abs, { write: true, createNew: true, mode });
  try {
    let at = 0;
    while (at < bytes.length) at += await out.write(bytes.subarray(at));
  } finally {
    out.close();
  }
  if (!windows) await Deno.chmod(abs, mode);
}

/** Makes each folder between `base` and `abs` that this export has not made yet, each one new. */
async function makeParents(base: string, abs: string, made: Set<string>): Promise<void> {
  const parents: string[] = [];
  for (let dir = dirname(abs); dir !== base; dir = dirname(dir)) parents.unshift(dir);
  for (const dir of parents) {
    if (made.has(dir)) continue;
    await Deno.mkdir(dir, { mode: 0o755 });
    made.add(dir);
  }
}

/** Every regular file under `dir`, refusing a link or anything else that is not a folder. */
async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isSymlink) throw new ExportRefused(`${path} is a link`);
    if (entry.isDirectory) files.push(...await walkFiles(path));
    else if (entry.isFile) files.push(path);
    else throw new ExportRefused(`${path} is not a regular file`);
  }
  return files;
}

function ignoreNotFound(err: unknown): void {
  if (!(err instanceof Deno.errors.NotFound)) throw err;
}
