import { join } from "@std/path";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import type {
  ProcessLauncher,
  ProcessSpec,
  Started,
} from "../../src/infrastructure/sandbox_process.ts";
import type { ScratchVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";

/** What the runner tests share: a launcher that records what it is asked to start. */

/** A macOS policy holds POSIX paths only: a Windows temp folder is refused by the profile. */
export const POSIX = Deno.build.os !== "windows";
export const COMMAND = ["deno", "task", "test"];
export const IMAGE = `acme/dev@sha256:${"c".repeat(64)}`;

export type Launch = { spec: ProcessSpec; pid: number; stopped: number; released: number };

/**
 * A launcher that records each launch. The first exits with `code`, or never when `null` (until
 * stopped); every later one (a watchdog, a removal) exits at once with 0.
 */
export function fakeLauncher(code: number | null = 0) {
  const launches: Launch[] = [];
  const synced: ProcessSpec[] = [];
  const launcher: ProcessLauncher = {
    start(spec): Started {
      const launch: Launch = { spec, pid: 4001 + launches.length, stopped: 0, released: 0 };
      launches.push(launch);
      let exit: (code: number) => void = () => {};
      const exited = new Promise<number>((ok) => (exit = ok));
      if (code !== null || launches.length > 1) exit(launches.length > 1 ? 0 : code ?? 0);
      const stop = () => {
        launch.stopped++;
        exit(137);
      };
      const release = () => launch.released++;
      return { pid: launch.pid, ended: exited, exited, stderr: Promise.resolve(""), stop, release };
    },
    runSync(spec) {
      synced.push(spec);
      return 0;
    },
  };
  return { launcher, launches, synced };
}

export const withWallClock = (policy: SandboxPolicy, seconds: number): SandboxPolicy => ({
  ...policy,
  limits: { ...policy.limits, wallClockSeconds: seconds },
});

/** A macOS policy whose writable folders sit in a real, empty scratch folder. */
export function seatbeltPolicy(scratch: string): SandboxPolicy {
  const real = Deno.realPathSync(scratch);
  const base = policyOf("seatbelt");
  return { ...base, scratch: real, writes: [join(real, "home"), join(real, "tmp")] };
}

/** The removal a {@link fakeVolumes} volume gives the run's watchdog. */
export const VOLUME_REMOVAL = ["/bin/echo", "volume-removal"];

/**
 * Scratch volumes that record `attach <mount> <bytes>` and `detach <mount>` in `events`, and mount
 * nothing; `refusal` makes every attach refuse with it.
 */
export function fakeVolumes(events: string[] = [], refusal?: string): ScratchVolumes {
  return {
    attach(mount, bytes) {
      events.push(`attach ${mount} ${bytes}`);
      if (refusal !== undefined) return Promise.reject(new SandboxRefused(refusal));
      const detach = () => Promise.resolve(void events.push(`detach ${mount}`));
      return Promise.resolve({ removal: VOLUME_REMOVAL, detach });
    },
  };
}

/** A container run's engine caps on a host that can apply every one and did not say its CPUs. */
export const NO_DROPS = { dropped: [], cpus: null } as const;
