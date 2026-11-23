import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import type { FilterRecord } from "../../src/domain/sandbox_filter_probe.ts";
import { podmanGlobals, SECCOMP } from "../../src/infrastructure/sandbox_engine_env.ts";
import type { ObservedRun } from "../../src/infrastructure/sandbox_filter_observer.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { COMMAND, containerTest, fakeLauncher, IMAGE, NO_DROPS } from "./sandbox_runner_fixture.ts";

/**
 * A container run observes its syscall filter before the command runs, in the run's own engine
 * environment and with the run's own profile file, and carries the record on its outcome.
 */

const PODMAN = "/opt/engines/podman";
const RECORD: FilterRecord = { kind: "observed", applied: ["mount"], dropped: ["open_tree_attr"] };

containerTest(
  "ContainerRunner: the filter is observed first, in the run's environment",
  async () => {
    const { launcher, launches } = fakeLauncher(5);
    const seen: { observed: ObservedRun; launchesBefore: number }[] = [];
    const observe = (observed: ObservedRun) => {
      seen.push({ observed, launchesBefore: launches.length });
      return Promise.resolve(RECORD);
    };
    const name = () => "specnaut-sandbox-x9";
    const env = () => ({ PATH: "/usr/bin:/bin", HOME: "/home/dev" });
    const policy = policyOf("container");
    const runner = new ContainerRunner(
      "podman",
      PODMAN,
      IMAGE,
      launcher,
      NO_DROPS,
      name,
      env,
      observe,
    );
    assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 5, filter: RECORD });
    assertEquals(seen.length, 1);
    const [{ observed, launchesBefore }] = seen;
    assertEquals(launchesBefore, 0, "observed before the command's launch");
    const dir = dirname(observed.run.seccomp);
    assertEquals(observed.run, {
      image: IMAGE,
      name: "specnaut-sandbox-x9",
      engine: "podman",
      dropped: [],
      cpus: null,
      seccomp: join(dir, SECCOMP),
    });
    assertEquals([observed.program, observed.launcher, observed.policy], [
      PODMAN,
      launcher,
      policy,
    ]);
    assertEquals(observed.runEnv.globals, podmanGlobals(dir));
    assertEquals(observed.runEnv.env, launches[0].spec.env, "the command's own environment");
  },
);

containerTest("ContainerRunner: a run with no observer carries no filter record", async () => {
  const { launcher } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", "/opt/engines/docker", IMAGE, launcher, NO_DROPS);
  assertEquals(await runner.run(policyOf("container"), COMMAND), { kind: "exited", code: 0 });
});
