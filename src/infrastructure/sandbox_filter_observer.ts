import { join } from "@std/path";
import type { SandboxPolicy } from "../domain/sandbox.ts";
import { containerArgs, type ContainerRun } from "../domain/sandbox_args.ts";
import {
  type FilterRecord,
  type ProbeCall,
  probeCalls,
  readProbe,
} from "../domain/sandbox_filter_probe.ts";
import { probeElf } from "../domain/sandbox_probe_elf.ts";
import type { FilterArch } from "../domain/sandbox_syscalls.ts";
import { removalOf, removed, thenRemoved } from "./sandbox_container_removal.ts";
import type { RunEnv } from "./sandbox_engine_env.ts";
import type { ProcessLauncher, ProcessSpec, Started } from "./sandbox_process.ts";
import { untilWallClock } from "./sandbox_wall_clock.ts";

/**
 * What a container run observed of its syscall filter: the filter probe (`probeElf`), run in a
 * container started as the run's is, with the same engine, environment, profile file and
 * arguments, the probe's folder mounted read-only beside the run's and its file the command. What
 * it prints is read by `readProbe`; a probe that could not run, or ran out of time, is recorded
 * unobserved with why, never as a filter in force.
 *
 * The probe's container is named after the run's and removed once it ends. It has no watchdog:
 * its command ends on its own in a moment, unlike a branch's gates.
 */

export type ObservedRun = {
  readonly launcher: ProcessLauncher;
  /** The engine's file, as the run starts it. */
  readonly program: string;
  readonly runEnv: Pick<RunEnv, "env" | "globals">;
  readonly policy: SandboxPolicy;
  readonly run: ContainerRun;
};

export type FilterObserver = (observed: ObservedRun) => Promise<FilterRecord>;

/** The probe's file, in a folder of its own. */
export const PROBE = "filter-probe";
/** How long the probe's container may take, image start included. */
export const PROBE_SECONDS = 60;

/** The observer of a run on an engine of `arch`. */
export function filterObserver(arch: FilterArch): FilterObserver {
  return async (observed) => {
    try {
      return await probed(arch, observed);
    } catch (err) {
      return { kind: "unobserved", why: `the filter probe could not run: ${messageOf(err)}` };
    }
  };
}

async function probed(arch: FilterArch, observed: ObservedRun): Promise<FilterRecord> {
  const { launcher, program, runEnv, policy, run } = observed;
  const calls = probeCalls(arch);
  const dir = await probeFolder(probeElf(arch, calls));
  try {
    const name = `${run.name}-filter`;
    const reads = [...policy.reads, dir];
    const args = containerArgs({ ...policy, reads }, { ...run, name }, [join(dir, PROBE)]);
    const { env, globals } = runEnv;
    const remove = removalOf(run.engine, program, name, env);
    const spec: ProcessSpec = {
      ...{ cmd: program, args: [...globals, ...args], env },
      ...{ stdout: "captured", stderr: "captured" },
    };
    return await answered(launcher, spec, remove, calls);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch((err) => {
      console.error(`warning: ${dir} could not be removed: ${messageOf(err)}`);
    });
  }
}

/**
 * A new folder holding the probe, both readable and executable by anyone: the container runs it
 * as `nobody`. Nothing in it is secret.
 */
async function probeFolder(probe: Uint8Array): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-filter-probe-" });
  const file = join(dir, PROBE);
  await Deno.writeFile(file, probe, { mode: 0o755 });
  await Deno.chmod(file, 0o755);
  await Deno.chmod(dir, 0o755);
  return dir;
}

/** The record of `spec`'s run, its container removed by `remove` once it ends. */
async function answered(
  launcher: ProcessLauncher,
  spec: ProcessSpec,
  remove: ProcessSpec,
  calls: readonly ProbeCall[],
): Promise<FilterRecord> {
  let started: Started | undefined;
  const outcome = await thenRemoved(launcher, remove, () => {
    started = launcher.start(spec);
    return untilWallClock(started, PROBE_SECONDS, () => removed(launcher, remove));
  });
  if (outcome.kind === "timed_out" || started === undefined) {
    return { kind: "unobserved", why: `the filter probe did not end within ${PROBE_SECONDS} s` };
  }
  if (outcome.removalFailed !== undefined) {
    console.error(`warning: the filter probe's container may be left: ${outcome.removalFailed}`);
  }
  const record = readProbe(calls, await started.stdout, outcome.code);
  const said = (await started.stderr).trim();
  return record.kind === "observed" || said === ""
    ? record
    : { ...record, why: `${record.why}: ${said}` };
}

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err);
