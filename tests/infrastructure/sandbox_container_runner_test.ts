import { assert, assertEquals } from "@std/assert";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { COMMAND, fakeLauncher, IMAGE, withWallClock } from "./sandbox_runner_fixture.ts";

/**
 * The container runner: the engine launched with exactly the domain's `run` arguments under a
 * fresh name, and the container removed by that name when the wall clock runs out.
 */

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
