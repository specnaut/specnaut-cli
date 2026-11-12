import { join } from "@std/path";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import type {
  ProcessLauncher,
  ProcessSpec,
  Started,
} from "../../src/infrastructure/sandbox_process.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";

/** What the runner tests share: a launcher that records what it is asked to start. */

/** A macOS policy holds POSIX paths only: a Windows temp folder is refused by the profile. */
export const POSIX = Deno.build.os !== "windows";
export const COMMAND = ["deno", "task", "test"];
export const IMAGE = `acme/dev@sha256:${"c".repeat(64)}`;

export type Launch = { spec: ProcessSpec; stopped: number };

/** A launcher that records each launch; each one exits with `code`, or never when `null`. */
export function fakeLauncher(code: number | null = 0) {
  const launches: Launch[] = [];
  const synced: ProcessSpec[] = [];
  const launcher: ProcessLauncher = {
    start(spec): Started {
      const launch: Launch = { spec, stopped: 0 };
      launches.push(launch);
      let exit: (code: number) => void = () => {};
      const exited = new Promise<number>((ok) => (exit = ok));
      if (code !== null || launches.length > 1) exit(code ?? 0);
      return {
        exited,
        stop: () => {
          launch.stopped++;
          exit(137);
        },
      };
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
  return { ...base, writes: [join(real, "home"), join(real, "tmp")] };
}
