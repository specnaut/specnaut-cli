import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import { bwrapArgs } from "../../src/domain/sandbox_bwrap_args.ts";
import { seatbeltProfile } from "../../src/domain/sandbox_seatbelt.ts";
import { SECCOMP_FD, seccompFilter } from "../../src/domain/sandbox_seccomp.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_bwrap_runner.ts";
import { ContainerRunner, runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { SeatbeltRunner, WATCHDOG_ENV } from "../../src/infrastructure/sandbox_seatbelt_runner.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import { watchdogSpec } from "../../src/infrastructure/sandbox_watchdog.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import {
  BWRAP,
  COMMAND,
  fakeLauncher,
  fakeVolumes,
  IMAGE,
  plantedPrograms,
  POSIX,
  seatbeltPolicy,
  VOLUME_REMOVAL,
  withWallClock,
} from "./sandbox_runner_fixture.ts";

/**
 * One runner per backend: each launches exactly what the domain generated for the policy
 * (bubblewrap's arguments with its syscall filter on its descriptor, the macOS profile), and stops
 * the run when the wall clock runs out. The container runner's own tests are beside this file.
 */

Deno.test("BwrapRunner: bubblewrap gets exactly bwrapArgs, the filter on its descriptor", async () => {
  const { launcher, launches } = fakeLauncher(5);
  const policy = policyOf("bwrap");
  const runner = new BwrapRunner("x86_64", launcher, "/usr/bin:/bin", BWRAP);
  assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 5 });
  const [launch] = launches;
  assertEquals(launch.spec.cmd, "/bin/sh");
  assertEquals(launch.spec.args, [
    "-c",
    `exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`,
    "sh",
    BWRAP,
    ...bwrapArgs(policy, COMMAND),
  ]);
  assertEquals(launch.spec.env, { PATH: "/usr/bin:/bin" });
  assertEquals(launch.spec.stdin, seccompFilter("x86_64"));
});

Deno.test("BwrapRunner: the filter is the host architecture's, and none other exists", () => {
  const { launcher } = fakeLauncher(0);
  assertThrows(() => new BwrapRunner("riscv64", launcher, "/usr/bin", BWRAP), Error, "riscv64");
});

Deno.test("BwrapRunner: past the wall clock bubblewrap is stopped", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const runner = new BwrapRunner("aarch64", launcher, "/usr/bin", BWRAP);
  const outcome = await runner.run(withWallClock(policyOf("bwrap"), 0.01), COMMAND);
  assertEquals(outcome, { kind: "timed_out", seconds: 0.01 });
  assertEquals(launches.length, 1);
  assertEquals(launches[0].stopped, 1);
});

Deno.test({
  name: "SeatbeltRunner: sandbox-exec gets exactly the profile, the env and the workdir",
  ignore: !POSIX,
  fn: async () => {
    const scratch = await Deno.makeTempDir({ prefix: "specnaut-runner-" });
    try {
      const { launcher, launches } = fakeLauncher(9);
      const policy = seatbeltPolicy(scratch);
      assertEquals(await new SeatbeltRunner(launcher, fakeVolumes()).run(policy, COMMAND), {
        kind: "exited",
        code: 9,
      });
      assertEquals(launches[0].spec, {
        cmd: "/usr/bin/sandbox-exec",
        args: ["-p", seatbeltProfile(policy), "--", ...COMMAND],
        env: policy.env,
        cwd: policy.workdir,
      });
      // Its watchdog kills the group past the clock and the grace, then ends the scratch volume,
      // and is stopped after the run.
      const wall = policy.limits.wallClockSeconds;
      const deadline = wall + DRAIN_GRACE_SECONDS;
      const watchdog = watchdogSpec(launches[0].pid, deadline, VOLUME_REMOVAL, WATCHDOG_ENV);
      assertEquals(launches[1].spec, watchdog);
      // Never our environment: its PATH would decide which `date` and `sleep` run on the host.
      assertEquals(launches[1].spec.env, { PATH: "/usr/bin:/bin" });
      assertEquals([launches.length, launches[1].stopped], [2, 1]);
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  },
});

Deno.test({
  name: "SeatbeltRunner: the sandbox's home and temp exist, empty, before it starts",
  ignore: !POSIX,
  fn: async () => {
    const scratch = await Deno.makeTempDir({ prefix: "specnaut-runner-" });
    try {
      const seen: string[][] = [];
      const { launcher } = fakeLauncher(0);
      const recording: ProcessLauncher = {
        ...launcher,
        start: (spec) => {
          seen.push(policyWrites.map((w) => [...Deno.readDirSync(w)].length === 0 ? w : "full"));
          return launcher.start(spec);
        },
      };
      const policy = seatbeltPolicy(scratch);
      const policyWrites = policy.writes;
      await new SeatbeltRunner(recording, fakeVolumes()).run(policy, COMMAND);
      assertEquals(seen[0], policy.writes as string[]);
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  },
});

Deno.test({
  name: "SeatbeltRunner: past the wall clock the process group is stopped",
  ignore: !POSIX,
  fn: async () => {
    const scratch = await Deno.makeTempDir({ prefix: "specnaut-runner-" });
    try {
      const { launcher, launches } = fakeLauncher(null);
      const policy = withWallClock(seatbeltPolicy(scratch), 0.01);
      assertEquals(await new SeatbeltRunner(launcher, fakeVolumes()).run(policy, COMMAND), {
        kind: "timed_out",
        seconds: 0.01,
      });
      assertEquals(launches[0].stopped, 1);
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  },
});

Deno.test({
  name: "SeatbeltRunner: a watchdog that cannot start stops the run, which never goes unwatched",
  ignore: !POSIX,
  fn: async () => {
    const scratch = await Deno.makeTempDir({ prefix: "specnaut-runner-" });
    try {
      const { launcher, launches } = fakeLauncher(null);
      const failing: ProcessLauncher = {
        ...launcher,
        start: (spec) => {
          if (launches.length > 0) throw new Error("no /bin/sh");
          return launcher.start(spec);
        },
      };
      const policy = withWallClock(seatbeltPolicy(scratch), 0.05);
      const run = () => new SeatbeltRunner(failing, fakeVolumes()).run(policy, COMMAND);
      await assertRejects(run, Error, "no /bin/sh");
      assertEquals(launches[0].stopped, 1);
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  },
});

Deno.test("runnerFor: one runner per backend, each handed its program's file on the PATH", async () => {
  const { launcher } = fakeLauncher(0);
  await using planted = await plantedPrograms(["docker", "bwrap"]);
  const host = { arch: "x86_64", path: planted.dir, bus: {} };
  const container = runnerFor(
    {
      kind: "container",
      engine: "docker",
      image: IMAGE,
      dropped: ["cpus"],
      cpus: null,
      arch: "x86_64",
    },
    launcher,
    host,
  );
  assert(container instanceof ContainerRunner);
  assertEquals([container.engine, container.caps.dropped], ["docker", ["cpus"]]);
  assertEquals(container.program, planted.at("docker"));
  assert(container.observe !== undefined, "a container run observes its filter");
  const oneCpu = {
    kind: "container",
    engine: "docker",
    image: IMAGE,
    dropped: [],
    cpus: 1,
    arch: "x86_64",
  } as const;
  assertEquals((runnerFor(oneCpu, launcher, host) as ContainerRunner).caps.cpus, 1);
  const bwrap = runnerFor({ kind: "bwrap", scope: false }, launcher, host);
  assert(bwrap instanceof BwrapRunner);
  assertEquals([bwrap.bwrap, bwrap.systemdRun], [planted.at("bwrap"), null]);
  const seatbelt = runnerFor({ kind: "seatbelt" }, launcher, host);
  assert(seatbelt instanceof SeatbeltRunner);
  // Its scratch is capped by a disk image, made through the run's own launcher.
  assert(seatbelt.volumes instanceof HdiutilVolumes);
  assertStrictEquals(seatbelt.volumes.launcher, launcher);
});
