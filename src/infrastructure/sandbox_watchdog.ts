import type { ProcessSpec } from "./sandbox_process.ts";

/**
 * A host watchdog beside a run, for the one end our wall clock cannot cover: our own death by
 * SIGKILL, which runs no exit trap. A container outlives its client, and a `sandbox-exec` run
 * outlives its launcher; bubblewrap needs none, as `--die-with-parent` ends it with us.
 *
 * It is a process group of its own, so a kill of ours spares it, and its output is /dev/null from
 * its first line, so a pipe to a dead launcher cannot end it with SIGPIPE. Once a second it checks
 * that the run's process group is still there, and leaves as soon as it is gone, before its id
 * can be reused. Past its deadline it runs the removal it was given, if any, then kills the group.
 * Our normal end stops it.
 */
const WATCHDOG = [
  "exec </dev/null >/dev/null 2>&1",
  "end=$(( $(date +%s) + $1 )); group=$2; shift 2",
  'while kill -0 -"$group"; do',
  '  if [ "$(date +%s)" -ge "$end" ]; then',
  '    if [ "$#" -gt 0 ]; then "$@"; fi',
  '    kill -KILL -"$group"; exit 0',
  "  fi",
  "  sleep 1",
  "done",
].join("\n");

/**
 * The watchdog of process group `group`: past `seconds` (rounded up) it runs `removal`, then
 * kills the group. It runs in our environment, which a container engine's client needs.
 */
export function watchdogSpec(
  group: number,
  seconds: number,
  removal: readonly string[] = [],
): ProcessSpec {
  const after = String(Math.ceil(seconds));
  return {
    cmd: "/bin/sh",
    args: ["-c", WATCHDOG, "specnaut-watchdog", after, String(group), ...removal],
    env: "host",
    stdout: "discarded",
  };
}
