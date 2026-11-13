import type { ProcessSpec } from "./sandbox_process.ts";

/**
 * A host watchdog beside a run, for the one end our wall clock cannot cover: our own death by
 * SIGKILL, which runs no exit trap. A container outlives its client, and a `sandbox-exec` run
 * outlives its launcher; bubblewrap needs none, as `--die-with-parent` ends it with us.
 *
 * It is a process group of its own, so a kill of ours spares it, and its output is /dev/null from
 * its first line, so a pipe to a dead launcher cannot end it with SIGPIPE. Once a second it checks
 * that the run's process group is still there; past its deadline it kills the group. Either way,
 * it then runs the removal it was given, if any, and leaves. The removal runs on the group's own
 * end too: a container client whose launcher was killed ends on its closed output, and its
 * container would otherwise outlive it. The group is killed first, so nothing of the run is left
 * to act while it is removed. The removal is keyed by name, never by the group's id, which may be
 * reused once the group is gone. Our normal end stops it.
 */
const WATCHDOG = [
  "exec </dev/null >/dev/null 2>&1",
  "end=$(( $(date +%s) + $1 )); group=$2; shift 2",
  'while kill -0 -"$group"; do',
  '  if [ "$(date +%s)" -ge "$end" ]; then kill -KILL -"$group"; break; fi',
  "  sleep 1",
  "done",
  'if [ "$#" -gt 0 ]; then "$@"; fi',
  "exit 0",
].join("\n");

/**
 * The watchdog of process group `group`: past `seconds` (rounded up) it kills the group; once the
 * group is gone, by its kill or its own end, it runs `removal`, in `env`: a container engine's
 * removal is given the engine's environment. Without one it runs in ours, starting nothing but
 * `date`, `sleep` and `kill` on the host.
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
