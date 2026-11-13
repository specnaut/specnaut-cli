import type { ProcessSpec } from "./sandbox_process.ts";

/**
 * A host watchdog beside a run, for the one end our wall clock cannot cover: our own death by
 * SIGKILL, which runs no exit trap. A container outlives its client, and a `sandbox-exec` run and
 * its scratch volume outlive their launcher; bubblewrap needs none, as `--die-with-parent` ends
 * it with us.
 *
 * It is a process group of its own, so a kill of ours spares it, and its output is /dev/null from
 * its first line, so a pipe to a dead launcher cannot end it with SIGPIPE. Once a second it checks
 * that the run's process group is still there; past its deadline it kills the group. It then runs
 * the removal it was given, if any, and leaves. A group that ended on its own is left to us while
 * we live, so our own teardown keeps its order: the removal runs once we are gone (`$PPID` no
 * longer answers), which a container client whose launcher was killed reaches as it ends on its
 * closed output, or at the deadline. The group is killed first, so nothing of the run is left to
 * act while it is removed. The removal is keyed by name, never by the group's id, which may be
 * reused once the group is gone. Our normal end stops it.
 */
const WATCHDOG = [
  "exec </dev/null >/dev/null 2>&1",
  "end=$(( $(date +%s) + $1 )); group=$2; parent=$PPID; shift 2",
  "while :; do",
  '  if kill -0 -"$group"; then',
  '    if [ "$(date +%s)" -ge "$end" ]; then kill -KILL -"$group"; break; fi',
  '  elif [ "$(date +%s)" -ge "$end" ] || ! kill -0 "$parent"; then',
  "    break",
  "  fi",
  "  sleep 1",
  "done",
  'if [ "$#" -gt 0 ]; then "$@"; fi',
  "exit 0",
].join("\n");

/**
 * The watchdog of process group `group`: past `seconds` (rounded up) it kills the group; once the
 * group is gone, by its kill, or by its own end and then ours or the deadline, it runs `removal`,
 * in `env`: a container engine's removal is given the engine's environment. Without one it runs
 * in ours, starting nothing but `date`, `sleep` and `kill` on the host.
 */
export function watchdogSpec(
  group: number,
  seconds: number,
  removal: readonly string[] = [],
  env: ProcessSpec["env"] = "host",
): ProcessSpec {
  const after = String(Math.ceil(seconds));
  return {
    cmd: "/bin/sh",
    args: ["-c", WATCHDOG, "specnaut-watchdog", after, String(group), ...removal],
    env,
    stdout: "discarded",
  };
}
