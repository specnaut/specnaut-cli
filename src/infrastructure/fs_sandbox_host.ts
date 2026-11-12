import { join } from "@std/path";
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
    readonly home: string,
    readonly checkout: () => Promise<string>,
  ) {}

  async locate(sha: string): Promise<HostFolders> {
    if (!isFullSha(sha)) throw new SandboxRefused(`${JSON.stringify(sha)} is not a full commit id`);
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

  async scratch(): Promise<ScratchFolder> {
    const path = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-sandbox-" }));
    const disarm = armExitTrap(() => removeSync(path));
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
 * Removes the scratch folder. A run may leave a folder it closed to writes, which stops a plain
 * removal; every folder is opened to its owner again, and the removal retried once.
 */
async function removeAll(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.PermissionDenied)) throw err;
    await reopen(path);
    await Deno.remove(path, { recursive: true });
  }
}

async function reopen(dir: string): Promise<void> {
  await Deno.chmod(dir, 0o700);
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) await reopen(join(dir, entry.name));
  }
}

/** The trap's removal: synchronous, as `unload` waits for nothing; a failure is reported. */
function removeSync(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      console.error(`warning: could not remove ${path}: ${(err as Error).message}`);
    }
  }
}
