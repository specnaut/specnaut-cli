import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { bwrapArgs, containerArgs } from "../../src/domain/sandbox_args.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import { seatbeltProfile } from "../../src/domain/sandbox_seatbelt.ts";
import { SECCOMP_FD, seccompFilter } from "../../src/domain/sandbox_seccomp.ts";
import type {
  ProcessLauncher,
  ProcessSpec,
  Started,
} from "../../src/infrastructure/sandbox_process.ts";
import {
  BwrapRunner,
  ContainerRunner,
  runnerFor,
  SeatbeltRunner,
} from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";

/**
 * One runner per backend: each launches exactly what the domain generated for the policy (the
 * container's `run` arguments, bubblewrap's arguments with its syscall filter on its descriptor,
 * the macOS profile), and stops the run when the wall clock runs out.
 */

/** A macOS policy holds POSIX paths only: a Windows temp folder is refused by the profile. */
const POSIX = Deno.build.os !== "windows";
const COMMAND = ["deno", "task", "test"];
const IMAGE = `acme/dev@sha256:${"c".repeat(64)}`;

type Launch = { spec: ProcessSpec; stopped: number };

/** A launcher that records each launch; each one exits with `code`, or never when `null`. */
function fakeLauncher(code: number | null = 0) {
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

const withWallClock = (policy: SandboxPolicy, seconds: number): SandboxPolicy => ({
  ...policy,
  limits: { ...policy.limits, wallClockSeconds: seconds },
});

Deno.test("ContainerRunner: launches the engine with exactly containerArgs, under a fresh name", async () => {
  const { launcher, launches } = fakeLauncher(3);
  const policy = policyOf("container");
  const runner = new ContainerRunner("podman", IMAGE, launcher, () => "specnaut-sandbox-x1");
  assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 3 });
  assertEquals(launches.map((l) => l.spec), [{
    cmd: "podman",
    args: containerArgs(policy, { image: IMAGE, name: "specnaut-sandbox-x1" }, COMMAND),
    env: "host",
  }]);
});

Deno.test("ContainerRunner: each run gets a name of its own", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", IMAGE, launcher);
  await runner.run(policyOf("container"), COMMAND);
  await runner.run(policyOf("container"), COMMAND);
  const names = launches.map((l) => l.spec.args[l.spec.args.indexOf("--name") + 1]);
  assert(/^specnaut-sandbox-[0-9a-f]{16}$/.test(names[0]), names[0]);
  assert(names[0] !== names[1]);
});

Deno.test("ContainerRunner: only a digest-pinned image is ever launched", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", "acme/dev:latest", launcher);
  let refused = false;
  await runner.run(policyOf("container"), COMMAND).catch(() => (refused = true));
  assert(refused);
  assertEquals(launches, []);
});

Deno.test("ContainerRunner: past the wall clock the container is removed by name", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const runner = new ContainerRunner("podman", IMAGE, launcher, () => "specnaut-sandbox-x2");
  const outcome = await runner.run(withWallClock(policyOf("container"), 0.01), COMMAND);
  assertEquals(outcome, { kind: "timed_out", seconds: 0.01 });
  assertEquals(launches[1].spec, {
    cmd: "podman",
    args: ["rm", "--force", "specnaut-sandbox-x2"],
    env: "host",
  });
  assertEquals(launches[0].stopped, 1);
});

Deno.test("BwrapRunner: bubblewrap gets exactly bwrapArgs, the filter on its descriptor", async () => {
  const { launcher, launches } = fakeLauncher(5);
  const policy = policyOf("bwrap");
  const runner = new BwrapRunner("x86_64", launcher, "/usr/bin:/bin");
  assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 5 });
  const [launch] = launches;
  assertEquals(launch.spec.cmd, "/bin/sh");
  assertEquals(launch.spec.args, [
    "-c",
    `exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`,
    "sh",
    "bwrap",
    ...bwrapArgs(policy, COMMAND),
  ]);
  assertEquals(launch.spec.env, { PATH: "/usr/bin:/bin" });
  assertEquals(launch.spec.stdin, seccompFilter("x86_64"));
});

Deno.test("BwrapRunner: the filter is the host architecture's, and none other exists", () => {
  const { launcher } = fakeLauncher(0);
  assertThrows(() => new BwrapRunner("riscv64", launcher, "/usr/bin"), Error, "riscv64");
});

Deno.test("BwrapRunner: past the wall clock bubblewrap is stopped", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const runner = new BwrapRunner("aarch64", launcher, "/usr/bin");
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
      assertEquals(await new SeatbeltRunner(launcher).run(policy, COMMAND), {
        kind: "exited",
        code: 9,
      });
      assertEquals(launches.map((l) => l.spec), [{
        cmd: "/usr/bin/sandbox-exec",
        args: ["-p", seatbeltProfile(policy), "--", ...COMMAND],
        env: policy.env,
        cwd: policy.workdir,
      }]);
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
      await new SeatbeltRunner(recording).run(policy, COMMAND);
      assertEquals(seen, [policy.writes as string[]]);
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
      assertEquals(await new SeatbeltRunner(launcher).run(policy, COMMAND), {
        kind: "timed_out",
        seconds: 0.01,
      });
      assertEquals(launches[0].stopped, 1);
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  },
});

Deno.test("runnerFor: one runner per backend", () => {
  const { launcher } = fakeLauncher(0);
  const host = { arch: "x86_64", path: "/usr/bin" };
  const container = runnerFor(
    { kind: "container", engine: "docker", image: IMAGE },
    launcher,
    host,
  );
  assert(container instanceof ContainerRunner);
  assertEquals(container.engine, "docker");
  assert(runnerFor({ kind: "bwrap" }, launcher, host) instanceof BwrapRunner);
  assert(runnerFor({ kind: "seatbelt" }, launcher, host) instanceof SeatbeltRunner);
});

/** A macOS policy whose writable folders sit in a real, empty scratch folder. */
function seatbeltPolicy(scratch: string): SandboxPolicy {
  const real = Deno.realPathSync(scratch);
  const base = policyOf("seatbelt");
  return { ...base, writes: [join(real, "home"), join(real, "tmp")] };
}
