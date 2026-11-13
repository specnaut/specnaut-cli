import {
  DenoProcessLauncher,
  type ProcessLauncher,
} from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";

/**
 * A stand-in for the CLI, for `sandbox_engine_interrupt_test.ts`, which stops it with SIGTERM: a
 * container run on `<engine>` whose every launch is made by the fake engine at `<fake>`, under a
 * 60 s wall clock. Not a test file.
 *
 *   <engine> <fake>
 */

const [engine, fake] = Deno.args;
const real = new DenoProcessLauncher();
const launcher: ProcessLauncher = {
  start: (spec) => real.start({ ...spec, cmd: fake }),
  runSync: (spec) => real.runSync({ ...spec, cmd: fake }),
};
const policy = policyOf("container");
const timed = { ...policy, limits: { ...policy.limits, wallClockSeconds: 60 } };
const runner = new ContainerRunner(
  engine as "podman" | "docker",
  `acme/dev@sha256:${"e".repeat(64)}`,
  launcher,
  { dropped: [], cpus: null },
  () => "specnaut-sandbox-i1",
);
await runner.run(timed, ["true"]);
