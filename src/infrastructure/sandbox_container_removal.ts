import type { RunOutcome } from "../application/sandbox_ports.ts";
import type { Engine } from "../domain/sandbox.ts";
import type { ProcessLauncher, ProcessSpec, Started } from "./sandbox_process.ts";

/**
 * A container run's removal: how its container is removed, and what a removal reports. Only the
 * last removal says whether the container is left, and it says so once.
 */

/**
 * Removes the named container, its name last; what the engine prints (the name) never passes for
 * the run's, and what it says of a failure is read (`removed`), not shown. Podman, unlike docker,
 * fails on a container already gone, as a `--rm` one is once it ended, unless told `--ignore`.
 */
export function removalOf(engine: Engine, name: string, env: Record<string, string>): ProcessSpec {
  const ignore = engine === "podman" ? ["--ignore"] : [];
  const args = ["rm", "--force", ...ignore, name];
  return { cmd: engine, args, env, stdout: "discarded", stderr: "captured" };
}

/**
 * Runs `remove` to its end: `null` once done or its container already gone, else what failed,
 * with what the engine said of it. A removal that cannot start, or whose end cannot be read, is a
 * failure reported to the caller, not raised: the run it follows has already ended.
 */
export async function removed(
  launcher: ProcessLauncher,
  remove: ProcessSpec,
): Promise<string | null> {
  const what = [remove.cmd, ...remove.args].join(" ");
  let started: Started;
  try {
    started = launcher.start(remove);
  } catch (err) {
    return `${what} could not start: ${(err as Error).message}`;
  }
  try {
    const code = await started.exited;
    const said = (await started.stderr).trim();
    if (code === 0 || alreadyGone(remove, said)) return null;
    return said === "" ? `${what} exited ${code}` : `${what} exited ${code}: ${said}`;
  } catch (err) {
    return `${what} started, but its end could not be read: ${(err as Error).message}`;
  }
}

/**
 * Whether a failed removal says its container is already gone. Docker 20.10 is the oldest the
 * sandbox supports: `run --pull never`, which keeps a run offline, first exists there, and from it
 * on `rm --force` succeeds on a missing container. A client before it refuses the run before any
 * container exists, then fails `rm --force` with "No such container: <name>" (from the client or
 * its daemon): read as the removal done, so a run that never started reports no container left.
 * The name is matched at a line's end, so another container whose name starts with it is not.
 */
function alreadyGone(remove: ProcessSpec, said: string): boolean {
  const gone = `No such container: ${remove.args.at(-1)}`;
  // At a line's end: a longer name that starts with this one is another container.
  return said.split("\n").some((line) => line.trimEnd().endsWith(gone));
}

/** How a run that throws names the container its removal left. */
const LEFT = "the container may be left";

/**
 * `run`'s outcome, once `remove` has run after it. A container is left only when every removal
 * failed: one that succeeds clears a failed halt, and the failure is the last removal's, said in
 * the outcome. A run that throws is raised, its message naming a removal that failed after it.
 */
export async function thenRemoved(
  launcher: ProcessLauncher,
  remove: ProcessSpec,
  run: () => Promise<RunOutcome>,
): Promise<RunOutcome> {
  let outcome: RunOutcome;
  try {
    outcome = await run();
  } catch (err) {
    const failed = await removed(launcher, remove);
    if (failed === null) throw err;
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`${why}; ${LEFT}: ${failed}`, { cause: err });
  }
  return withRemoval(outcome, await removed(launcher, remove));
}

/** `outcome` with the last removal's word on it: `failed`, or `null` once the container is gone. */
function withRemoval(outcome: RunOutcome, failed: string | null): RunOutcome {
  if (outcome.kind === "exited") {
    return failed === null ? outcome : { ...outcome, removalFailed: failed };
  }
  if (outcome.haltFailed === undefined) return outcome; // the halt removed it
  const { seconds } = outcome;
  return failed === null ? { kind: "timed_out", seconds } : { ...outcome, haltFailed: failed };
}
