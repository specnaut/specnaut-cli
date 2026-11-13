import { armExitTrap } from "./exit_trap.ts";

/**
 * How a sandbox's launcher process and its process group are killed: when it is stopped, when the
 * process exits, and when its child ends, the group's last kill. POSIX gives the process a group of
 * its own; Windows has none, and the child alone is killed there.
 *
 * A stop kills the leader by its pid as well as its group: a group the leader has left is gone, or
 * no longer holds it, and its kill would leave the leader running past the deadline, the run then
 * waiting on it. Only a stop does: once the child has ended, its pid is reaped and may be a
 * stranger's, so the retirement kills the group alone.
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
    if (gone) return;
    try {
      if (LEADS_A_GROUP) killedUnlessGone(() => Deno.kill(child.pid, "SIGKILL"));
    } finally {
      killGroup(child);
    }
  };
  const disarm = armExitTrap(stop);
  const retire = () => {
    try {
      if (!gone) killGroup(child);
    } finally {
      gone = true;
      disarm();
    }
  };
  return { stop, retire };
}

/**
 * Kills the child's process group (POSIX), or the child alone (Windows). A group already gone is
 * not an error: on macOS a group whose ended leader is the only member left answers
 * `PermissionDenied`; no live process of ours is spared by either answer.
 */
function killGroup(child: Deno.ChildProcess): void {
  killedUnlessGone(() => {
    if (LEADS_A_GROUP) Deno.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  });
}

/**
 * Runs `kill`; a process or group it finds gone is no error: `NotFound` once it is reaped, and on
 * macOS `PermissionDenied` while it has ended but is not yet reaped.
 */
function killedUnlessGone(kill: () => void): void {
  try {
    kill();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    if (err instanceof Deno.errors.PermissionDenied && Deno.build.os === "darwin") return;
    throw err;
  }
}
