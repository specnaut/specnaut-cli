import { assertEquals, assertRejects } from "@std/assert";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { COMMAND, fakeLauncher, IMAGE, withWallClock } from "./sandbox_runner_fixture.ts";

/**
 * What a container run reports of its container's removal: only the last removal says whether the
 * container is left, it says so once, in the run's outcome, and a container already gone is
 * removed, whatever the engine's version answers for it.
 */

const NAME = "specnaut-sandbox-r1";
const RM = `docker rm --force ${NAME}`;

/** A removal's end: its exit code and what it wrote to its standard error. */
type Removal = { readonly code: number; readonly stderr?: string };

/**
 * `fakeLauncher(code)`, whose removals end, in turn, as `removals` say; any past them succeed.
 * `starts` names a launch that cannot start.
 */
function removing(code: number | null, removals: Removal[], starts = (_: string) => true) {
  const { launcher, launches } = fakeLauncher(code);
  const ends = [...removals];
  const removingLauncher: ProcessLauncher = {
    ...launcher,
    start: (spec) => {
      if (!starts(spec.cmd)) throw new Error(`no ${spec.cmd}`);
      const started = launcher.start(spec);
      const end = spec.args[0] === "rm" ? ends.shift() : undefined;
      if (end === undefined) return started;
      const ended = Promise.resolve(end.code);
      return { ...started, ended, exited: ended, stderr: Promise.resolve(end.stderr ?? "") };
    },
  };
  return { launcher: removingLauncher, launches };
}

/** `fn`'s result, and every line it wrote through `console.error`, which it must not use. */
async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    return { result: await fn(), errors };
  } finally {
    console.error = real;
  }
}

const runOn = (launcher: ProcessLauncher, seconds = 60) =>
  new ContainerRunner("docker", IMAGE, launcher, [], () => NAME).run(
    withWallClock(policyOf("container"), seconds),
    COMMAND,
  );

Deno.test("ContainerRunner: a failed stop at the wall clock that a later removal makes good is not reported", async () => {
  const { launcher } = removing(null, [{ code: 1 }, { code: 0 }]);
  const { result, errors } = await quiet(() => runOn(launcher, 0.01));
  assertEquals(result, { kind: "timed_out", seconds: 0.01 });
  assertEquals(errors, []);
});

Deno.test("ContainerRunner: a container that two removals leave is named once, in the outcome", async () => {
  const { launcher } = removing(null, [{ code: 1 }, { code: 2, stderr: "daemon down\n" }]);
  const { result, errors } = await quiet(() => runOn(launcher, 0.01));
  assertEquals(result, {
    kind: "timed_out",
    seconds: 0.01,
    haltFailed: `${RM} exited 2: daemon down`,
  });
  assertEquals(errors, []);
});

Deno.test("ContainerRunner: a run that ended, whose container is left, says so in its outcome", async () => {
  const { launcher } = removing(0, [{ code: 1 }]);
  const { result, errors } = await quiet(() => runOn(launcher));
  assertEquals(result, { kind: "exited", code: 0, removalFailed: `${RM} exited 1` });
  assertEquals(errors, []);
});

Deno.test("ContainerRunner: a run that fails, whose container is left, says both in its error", async () => {
  const { launcher } = removing(null, [{ code: 1 }], (cmd) => cmd !== "/bin/sh");
  const { errors } = await quiet(() =>
    assertRejects(
      () => runOn(launcher),
      Error,
      `no /bin/sh; the container may be left: ${RM} exited 1`,
    )
  );
  assertEquals(errors, []);
});

Deno.test("ContainerRunner: a container already gone is removed, on docker before 20.10 too", async () => {
  // Docker before 20.10 fails `rm --force` on a missing container, from its client or its daemon.
  for (
    const said of ["Error: No such container: ", "Error response from daemon: No such container: "]
  ) {
    const { launcher } = removing(0, [{ code: 1, stderr: `${said}${NAME}\n` }]);
    assertEquals(await runOn(launcher), { kind: "exited", code: 0 });
  }
});

Deno.test("ContainerRunner: another container's absence is not this one's removal", async () => {
  const { launcher } = removing(0, [{ code: 1, stderr: "Error: No such container: other\n" }]);
  const { result } = await quiet(() => runOn(launcher));
  assertEquals(result, {
    kind: "exited",
    code: 0,
    removalFailed: `${RM} exited 1: Error: No such container: other`,
  });
});

Deno.test("ContainerRunner: a removal's own error text is read, never copied to ours", async () => {
  const { launcher, launches } = removing(0, []);
  await runOn(launcher);
  const removals = launches.filter((l) => l.spec.args[0] === "rm");
  assertEquals(removals.map((l) => l.spec.stderr), ["captured"]);
});
