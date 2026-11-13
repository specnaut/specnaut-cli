import { assertEquals, assertRejects } from "@std/assert";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";
import {
  COMMAND,
  fakeLauncher,
  fakeVolumes,
  POSIX,
  seatbeltPolicy,
  withWallClock,
} from "./sandbox_runner_fixture.ts";

/**
 * `sandbox-exec` has no size option, so the scratch cap is a volume the runner mounts on the
 * policy's scratch folder for the run: attached before anything is made in it, and detached after
 * the run however it ended. A volume that cannot be attached refuses the run, which never goes
 * ahead uncapped.
 */

/** The run of `policy` on `launcher`, each attach, detach, folder made and launch in `events`. */
async function recorded(
  launcher: ProcessLauncher,
  policy: SandboxPolicy,
  events: string[],
  refusal?: string,
) {
  const recording: ProcessLauncher = {
    ...launcher,
    start: (spec) => {
      const made = policy.writes.filter((w) => exists(w)).length;
      events.push(`start ${spec.cmd} with ${made} folders`);
      return launcher.start(spec);
    },
  };
  return await new SeatbeltRunner(recording, fakeVolumes(events, refusal)).run(policy, COMMAND);
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** `fn` given a real, empty scratch folder, removed after it. */
async function inScratch(fn: (scratch: string) => Promise<void>): Promise<void> {
  const scratch = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-volume-" }));
  try {
    await fn(scratch);
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

Deno.test({
  name: "SeatbeltRunner: the volume is attached on the scratch at its cap first, detached last",
  ignore: !POSIX,
  fn: () =>
    inScratch(async (scratch) => {
      const events: string[] = [];
      const policy = seatbeltPolicy(scratch);
      const outcome = await recorded(fakeLauncher(3).launcher, policy, events);
      assertEquals(outcome, { kind: "exited", code: 3 });
      assertEquals(events, [
        `attach ${scratch} ${policy.limits.scratchBytes}`,
        "start /usr/bin/sandbox-exec with 2 folders",
        "start /bin/sh with 2 folders",
        `detach ${scratch}`,
      ]);
    }),
});

Deno.test({
  name: "SeatbeltRunner: the volume is detached after a run the wall clock stopped",
  ignore: !POSIX,
  fn: () =>
    inScratch(async (scratch) => {
      const events: string[] = [];
      const policy = withWallClock(seatbeltPolicy(scratch), 0.01);
      const outcome = await recorded(fakeLauncher(null).launcher, policy, events);
      assertEquals(outcome, { kind: "timed_out", seconds: 0.01 });
      assertEquals(events.at(-1), `detach ${scratch}`);
    }),
});

Deno.test({
  name: "SeatbeltRunner: the volume is detached after a run that throws",
  ignore: !POSIX,
  fn: () =>
    inScratch(async (scratch) => {
      const events: string[] = [];
      const { launcher, launches } = fakeLauncher(null);
      const noWatchdog: ProcessLauncher = {
        ...launcher,
        start: (spec) => {
          if (launches.length > 0) throw new Error("no /bin/sh");
          return launcher.start(spec);
        },
      };
      const policy = withWallClock(seatbeltPolicy(scratch), 0.05);
      await assertRejects(() => recorded(noWatchdog, policy, events), Error, "no /bin/sh");
      assertEquals(events.at(-1), `detach ${scratch}`);
    }),
});

Deno.test({
  name: "SeatbeltRunner: a volume that cannot be attached refuses the run; nothing is started",
  ignore: !POSIX,
  fn: () =>
    inScratch(async (scratch) => {
      const events: string[] = [];
      const policy = seatbeltPolicy(scratch);
      const refusal = "the scratch volume could not be attached";
      const { launcher, launches } = fakeLauncher(0);
      await assertRejects(
        () => recorded(launcher, policy, events, refusal),
        SandboxRefused,
        refusal,
      );
      assertEquals(launches, []);
      assertEquals(events, [`attach ${scratch} ${policy.limits.scratchBytes}`]);
      assertEquals(policy.writes.filter(exists), [], "a folder was made with no volume under it");
    }),
});
