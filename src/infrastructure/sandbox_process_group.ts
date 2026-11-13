import { armExitTrap } from "./exit_trap.ts";

/**
 * How a sandbox's launcher process and its process group are killed: when it is stopped, when the
 * process exits, and when its child ends, the group's last kill. POSIX gives the process a group of
 * its own; Windows has none, and the child alone is killed there.
 */

/** Whether a started process leads a process group of its own: POSIX only. */
export const LEADS_A_GROUP = Deno.build.os !== "windows";

/**
 * How `child`'s group is stopped, and its retirement once the child has ended: the group's last
 * kill, after which it is never signalled again, as its id may be reused by a stranger's group.
 * The retirement holds even when that kill throws, the error raised after it.
 */
export function groupStop(child: Deno.ChildProcess): { stop: () => void; retire: () => void } {
  let gone = false;
  const stop = () => {
    if (!gone) killGroup(child);
  };
  const disarm = armExitTrap(stop);
  const retire = () => {
    try {
      stop();
    } finally {
      gone = true;
      disarm();
    }
  };
  return { stop, retire };
}

/**
 * Kills the child's process group (POSIX), or the child alone (Windows). A group already gone is
 * not an error: `NotFound` once it is reaped, and on macOS `PermissionDenied` while its leader has
 * ended but is not yet reaped, the only member left; no live process of ours is spared by either.
 */
function killGroup(child: Deno.ChildProcess): void {
  try {
    if (LEADS_A_GROUP) Deno.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    if (err instanceof Deno.errors.PermissionDenied && Deno.build.os === "darwin") return;
    throw err;
  }
}
