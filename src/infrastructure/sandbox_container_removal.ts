import type { Engine } from "../domain/sandbox.ts";
import type { ProcessLauncher, ProcessSpec } from "./sandbox_process.ts";

/** A container run's removal: how its container is removed, and what a removal reports. */

/**
 * Removes the named container; what the engine prints (the name) never passes for the run's.
 * Podman, unlike docker, fails on a container already gone, as a `--rm` one is once it ended.
 */
export function removalOf(engine: Engine, name: string, env: Record<string, string>): ProcessSpec {
  const ignore = engine === "podman" ? ["--ignore"] : [];
  return { cmd: engine, args: ["rm", "--force", ...ignore, name], env, stdout: "discarded" };
}

/**
 * Runs `remove` to its end: `null` once done, else what failed. A removal that cannot start is a
 * failure reported to the caller, not raised: the run it follows has already ended.
 */
export async function removed(
  launcher: ProcessLauncher,
  remove: ProcessSpec,
): Promise<string | null> {
  const what = [remove.cmd, ...remove.args].join(" ");
  try {
    const code = await launcher.start(remove).exited;
    return code === 0 ? null : `${what} exited ${code}`;
  } catch (err) {
    return `${what} could not start: ${(err as Error).message}`;
  }
}
