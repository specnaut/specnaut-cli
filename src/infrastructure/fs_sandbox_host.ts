import { dirname, join } from "@std/path";
import {
  type HostFolders,
  type SandboxHost,
  SandboxRefused,
  type ScratchFolder,
} from "../application/sandbox_ports.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import { armExitTrap } from "./exit_trap.ts";
import { securePrivateFolder } from "./private_folder.ts";

/**
 * The host folders of a sandboxed run. The tree is an export's scratch copy, found by its commit
 * under the cache folder the export store writes (`fs_tree_export.ts`): only a copy that store made
 * is ever run, never a folder a caller names. Every path is resolved, and a scratch copy reached
 * through a link is refused. The scratch folder is new, private, and removed after the run, or by
 * an exit trap when the run is interrupted.
 */
export class FsSandboxHost implements SandboxHost {
  constructor(
    readonly cacheRoot: string,
    /** The user's home, as HOME names it: empty when HOME is unset or empty, which is refused. */
    readonly home: string,
    readonly checkout: () => Promise<string>,
  ) {}

  async locate(sha: string): Promise<HostFolders> {
    if (!isFullSha(sha)) throw new SandboxRefused(`${JSON.stringify(sha)} is not a full commit id`);
    // Resolved, an empty home is the working folder: the layout would keep the wrong folder out.
    if (this.home === "") {
      throw new SandboxRefused("HOME is unset or empty: the home folder to keep out is unknown");
    }
    const missing = `no export of ${sha}: export the branch first`;
    const root = await real(this.cacheRoot, missing);
    await securePrivateFolder(root);
    const expected = join(root, sha, "scratch");
    const tree = await real(expected, missing);
    if (tree !== expected) {
      throw new SandboxRefused(`the scratch copy of ${sha} is reached through a link`);
    }
    if (!(await Deno.lstat(tree)).isDirectory) {
      throw new SandboxRefused(`the scratch copy of ${sha} is not a folder`);
    }
    return { tree, home: await real(this.home, "no home folder"), checkout: await this.checkout() };
  }

  async real(folders: readonly string[]): Promise<string[]> {
    const found: string[] = [];
    for (const folder of folders) found.push(await real(folder, `no folder ${folder}`));
    return found;
  }

  async scratch(): Promise<ScratchFolder> {
    const path = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-sandbox-" }));
    const disarm = armExitTrap(() => removeScratchSync(path));
    return {
      path,
      remove: async () => {
        await removeAll(path);
        disarm();
      },
    };
  }
}

async function real(path: string, missing: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new SandboxRefused(missing, { cause: err });
    throw err;
  }
}

/**
 * Removes the scratch folder. An empty one goes in place: on macOS it is the mount point a volume
 * left closed to writes (`sandbox_scratch_volume.ts`), so nothing the run left behind could put
 * anything in it, and removing it needs no more than the folder above. One that holds something
 * is opened to its owner, then moved into a new private folder beside it, so its path no longer
 * matches the run's write rule and nothing the run left behind can still change it. A run may
 * leave a folder it closed to writes, which stops a plain removal; every real folder is then opened
 * to its owner again, a link never followed, and the removal retried once.
 */
async function removeAll(path: string): Promise<void> {
  if (await removedIfEmpty(path)) return;
  await Deno.chmod(path, 0o700);
  const holder = await Deno.makeTempDir({ dir: dirname(path), prefix: "specnaut-sandbox-done-" });
  await Deno.rename(path, join(holder, "scratch"));
  try {
    await Deno.remove(holder, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.PermissionDenied)) throw err;
    await reopen(holder);
    await Deno.remove(holder, { recursive: true });
  }
}

/** The system `chmod` walk `reopen` runs: recursive, physical, so a link is never traversed. */
export const REOPEN_ARGS = (dir: string) => ["-R", "-P", "u+rwx", dir];

/** Runs `chmod` with `args`; the exit code and what it printed on stderr. */
export type ChmodRun = (args: string[]) => Promise<{ code: number; stderr: string }>;

const systemChmod: ChmodRun = async (args) => {
  const out = await new Deno.Command("/bin/chmod", { args, stdout: "null", stderr: "piped" })
    .output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
};

/**
 * Opens `dir` and every real folder under it to its owner; a link is left as it is, at any depth.
 * The walk is the system `chmod -R -P`'s, which descends through each folder it opened, rather than
 * one made here path by path.
 */
export async function reopen(dir: string, run: ChmodRun = systemChmod): Promise<void> {
  if (!(await Deno.lstat(dir)).isDirectory) return;
  const { code, stderr } = await run(REOPEN_ARGS(dir));
  if (code !== 0) throw new Error(`chmod could not open ${dir} to its owner: ${stderr.trim()}`);
}

/** Whether `path` was an empty folder, now removed; one that holds something is left as it was. */
async function removedIfEmpty(path: string): Promise<boolean> {
  try {
    await Deno.remove(path);
    return true;
  } catch (err) {
    if (notEmpty(err)) return false;
    throw err;
  }
}

/** Whether `err` is a folder's removal refused because it still holds something. */
function notEmpty(err: unknown): boolean {
  return (err as { code?: string }).code === "ENOTEMPTY";
}

/**
 * The exit trap's removal of the scratch folder: synchronous, as `unload` waits for nothing. An
 * empty one goes in place, as {@link removeAll}'s does; one that holds something is opened to its
 * owner and removed with what it holds. A failure is reported.
 */
export function removeScratchSync(path: string): void {
  try {
    try {
      Deno.removeSync(path);
    } catch (err) {
      if (!notEmpty(err)) throw err;
      Deno.chmodSync(path, 0o700);
      Deno.removeSync(path, { recursive: true });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      console.error(`warning: could not remove ${path}: ${(err as Error).message}`);
    }
  }
}
