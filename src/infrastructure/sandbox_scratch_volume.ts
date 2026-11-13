import { dirname, join } from "@std/path";
import { SandboxRefused } from "../application/sandbox_ports.ts";
import { armExitTrap } from "./exit_trap.ts";
import type { ProcessLauncher } from "./sandbox_process.ts";

/**
 * The scratch cap on macOS, where `sandbox-exec` has no size option: the run's scratch folder is
 * the mount point of a sparse APFS disk image of the cap's size, attached for the run, then
 * detached and deleted. The image lies in a private folder of its own, out of the sandbox's reach.
 * An image that cannot be made, attached, or found mounted where it was asked refuses the run,
 * which never goes ahead uncapped.
 */

export type ScratchVolume = {
  /**
   * What the run's watchdog runs once the run's group is gone: a forced detach, then the image's
   * deletion. It ends the volume when we were killed with SIGKILL and ran no exit trap.
   */
  readonly removal: readonly string[];
  /** Detaches it, by force when a plain detach fails, then deletes its image; raises a failure. */
  detach(): Promise<void>;
};

export interface ScratchVolumes {
  /** A volume of `bytes`, mounted on `mount`, an empty folder, for the user alone. */
  attach(mount: string, bytes: number): Promise<ScratchVolume>;
}

/**
 * What a volume's end is judged and guarded by: a mount point's test, synchronous so the exit trap
 * can ask it too, and the exit trap.
 */
export type VolumeHost = {
  readonly mounted: (path: string) => boolean;
  readonly arm: (cleanup: () => void) => () => void;
};

const HDIUTIL = "/usr/bin/hdiutil";
const MIB = 1024 ** 2;

/**
 * The watchdog's removal, `$1` the mount, `$2` the image's folder, `$3` hdiutil. The forced detach
 * runs only on a mount point (another device than the folder above it): on a plain folder it
 * would detach the volume holding that folder. hdiutil's word is not read, as the image is
 * deleted either way; a volume that is somehow still attached is gone at the next restart.
 */
const REMOVAL = 'd=$(/usr/bin/stat -f %d "$1") && p=$(/usr/bin/stat -f %d "$1/..") && ' +
  '[ "$d" != "$p" ] && "$3" detach -force "$1"; /bin/rm -rf -- "$2"';

/** The image's creation: `size` rounded up to whole MiB, so the cap is never below the policy's. */
const createArgs = (base: string, bytes: number) => [
  ...["create", "-size", `${Math.ceil(bytes / MIB)}m`, "-type", "SPARSE", "-fs", "APFS"],
  ...["-volname", "specnaut-scratch", base],
];

/**
 * The attach: owners honoured, so the root's mode keeps other users out as the folder's did,
 * kept out of the Finder and Spotlight, mounted on the scratch folder itself.
 */
const attachArgs = (
  mount: string,
  image: string,
) => ["attach", "-owners", "on", "-nobrowse", "-noautoopen", "-mountpoint", mount, image];

export class HdiutilVolumes implements ScratchVolumes {
  constructor(readonly launcher: ProcessLauncher, readonly host: VolumeHost = HOST) {}

  async attach(mount: string, bytes: number): Promise<ScratchVolume> {
    const folder = await Deno.makeTempDir({ prefix: "specnaut-scratch-image-" });
    const disarm = this.host.arm(() => this.#endSync(mount, folder));
    try {
      await this.#made(mount, folder, bytes);
    } catch (err) {
      await this.#endedAfterRefusal(mount, folder, disarm);
      throw err;
    }
    const detach = async () => {
      await this.#ended(mount, folder);
      disarm();
    };
    return { removal: ["/bin/sh", "-c", REMOVAL, "sh", mount, folder, HDIUTIL], detach };
  }

  /** What a refused attach left goes now; what cannot go yet is tried again at exit. */
  async #endedAfterRefusal(mount: string, folder: string, disarm: () => void): Promise<void> {
    try {
      await this.#ended(mount, folder);
      disarm();
    } catch (end) {
      console.error(`warning: the scratch volume was not cleaned up: ${(end as Error).message}`);
    }
  }

  /**
   * The image made in `folder` and attached on `mount`, its root closed to all but its owner. The
   * folder under it is closed to writes first, its owner's included: once the volume is detached
   * the path is that folder again, and the profile's write rule still matches it, so a process the
   * run left behind could otherwise make home or temp there and write to the host's disk uncapped.
   */
  async #made(mount: string, folder: string, bytes: number): Promise<void> {
    const base = join(folder, "scratch");
    await this.#refusedUnless("create", createArgs(base, bytes));
    await Deno.chmod(mount, 0o500);
    await this.#refusedUnless("attach", attachArgs(mount, `${base}.sparseimage`));
    if (!this.host.mounted(mount)) {
      throw new SandboxRefused(`the scratch volume is not mounted on ${mount} after its attach`);
    }
    await Deno.chmod(mount, 0o700);
  }

  /** Runs hdiutil `args`; one that cannot start or fails refuses the run with what it said. */
  async #refusedUnless(verb: string, args: string[]): Promise<void> {
    const failed = await this.#hdiutil(args);
    if (failed !== null) throw new SandboxRefused(`the scratch volume: hdiutil ${verb} ${failed}`);
  }

  /**
   * The volume on `mount` detached, by force if need be, and `folder` with its image deleted. The
   * watchdog's removal may have done both first: it runs once the run's group is gone, while the
   * run may still be draining the output of a process that left the group.
   */
  async #ended(mount: string, folder: string): Promise<void> {
    // Each detach is asked for only while a volume is mounted there: one forced on a plain folder
    // would detach the volume that holds it.
    const plain = this.host.mounted(mount) ? await this.#hdiutil(["detach", mount]) : null;
    const forced = plain !== null && this.host.mounted(mount)
      ? await this.#hdiutil(["detach", "-force", mount])
      : null;
    if (forced !== null && this.host.mounted(mount)) {
      throw new Error(`the scratch volume on ${mount} could not be detached: ${forced}`);
    }
    await removed(folder);
  }

  /** `null` once hdiutil `args` exited 0; else how it failed, with what it said. */
  async #hdiutil(args: string[]): Promise<string | null> {
    try {
      const started = this.launcher.start({
        cmd: HDIUTIL,
        args,
        env: "host",
        stdout: "discarded",
        stderr: "captured",
      });
      const code = await started.exited;
      const said = (await started.stderr).trim();
      if (code === 0) return null;
      return said === "" ? `exited ${code}` : `exited ${code}: ${said}`;
    } catch (err) {
      return `could not start: ${(err as Error).message}`;
    }
  }

  /** The exit trap's end: synchronous, as `unload` waits for nothing; a failure is reported. */
  #endSync(mount: string, folder: string): void {
    if (this.host.mounted(mount)) {
      const args = ["detach", "-force", mount];
      const code = this.launcher.runSync({ cmd: HDIUTIL, args, env: "host" });
      if (code !== 0) {
        console.error(
          `warning: the scratch volume on ${mount} could not be detached (exited ${code})`,
        );
      }
    }
    try {
      Deno.removeSync(folder, { recursive: true });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      console.error(`warning: could not remove ${folder}: ${(err as Error).message}`);
    }
  }
}

/** Removes `folder` and what it holds; one already removed is no error. */
async function removed(folder: string): Promise<void> {
  try {
    await Deno.remove(folder, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

/** Whether `path` is a mount point: on another device than the folder holding it. */
function mounted(path: string): boolean {
  try {
    return Deno.statSync(path).dev !== Deno.statSync(dirname(path)).dev;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

const HOST: VolumeHost = { mounted, arm: armExitTrap };
