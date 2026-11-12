import { dirname, isAbsolute, join } from "@std/path";
import {
  type ExportHome,
  ExportRefused,
  type ExportStore,
  type TreeObjects,
} from "../application/untrusted_review_ports.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { ExportPlan } from "../domain/tree_plan.ts";
import { isInside } from "../domain/destination.ts";
import { armExitTrap } from "./exit_trap.ts";
import { verifyCopy, writeCopies } from "./fs_export_files.ts";
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
    if (!isFullSha(sha)) throw new ExportRefused("not a full commit id");
    const staging = dirname(staged);
    if (!this.#made.includes(staging)) throw new Error("claim takes the path stage handed out");
    // The staging check above proves `stage` ran, so the root it resolved is set.
    const root = join(this.#root!, sha);
    await claimNew(root);
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
    await writeCopies(this.#claimed(), plan, objects);
  }

  async verify(plan: ExportPlan): Promise<void> {
    await verifyCopy(this.#claimed().seats, plan);
  }

  /** Tries every folder this store made, then reports each one it could not remove. */
  async remove(): Promise<void> {
    const failed: unknown[] = [];
    for (const path of this.#made.splice(0).reverse()) {
      await Deno.remove(path, { recursive: true }).catch(ignoreNotFound).catch((e) =>
        failed.push(e)
      );
    }
    this.#disarm?.();
    this.#disarm = undefined;
    if (failed.length > 0) {
      throw new AggregateError(failed, `could not remove ${failed.length} folder(s) of the export`);
    }
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
 * Makes the commit's folder, or refuses: a folder already there belongs to another export of the
 * same commit, still in use or left by one that could not clean up, and is never reused or removed.
 */
async function claimNew(root: string): Promise<void> {
  try {
    await Deno.mkdir(root, { mode: 0o700 });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    throw new ExportRefused(
      `an export of this commit is already at ${root}: another one uses it, or one was interrupted`,
      { cause: err },
    );
  }
}

function ignoreNotFound(err: unknown): void {
  if (!(err instanceof Deno.errors.NotFound)) throw err;
}
