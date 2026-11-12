import { join } from "@std/path";
import { type Engine, type SandboxedBackend, sandboxPolicy } from "../../src/domain/sandbox.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner, SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";

/**
 * A stand-in for the CLI, for the live tests that kill it with SIGKILL, in folders made under
 * `<base>` (so the test can remove what a killed process cannot). Not a test file.
 *
 *   <base> seatbelt <seconds>                runs `/bin/sleep <seconds>` under a 1 s wall clock
 *   <base> container <engine> <image> <name> runs a command printing a line every 0.2 s for 30 s,
 *                                            in container <name>, under a 60 s wall clock
 */

const [base, backend, ...rest] = Deno.args;
const tree = join(base, "tree");
const scratch = join(base, "scratch");
await Deno.mkdir(tree);
await Deno.mkdir(scratch);
const result = sandboxPolicy(backend as SandboxedBackend, {
  tree,
  scratch,
  toolchain: [],
  path: [],
  home: await Deno.realPath(Deno.env.get("HOME")!),
  checkout: join(base, "checkout"),
});
if (!result.ok) throw new Error(result.why);
const launcher = new DenoProcessLauncher();
const timed = (seconds: number) => ({
  ...result.policy,
  limits: { ...result.policy.limits, wallClockSeconds: seconds },
});
if (backend === "seatbelt") {
  await new SeatbeltRunner(launcher).run(timed(1), ["/bin/sleep", rest[0]]);
} else {
  const [engine, image, name] = rest;
  const ticks = "i=0; while [ $i -lt 150 ]; do echo tick; sleep 0.2; i=$((i+1)); done";
  const runner = new ContainerRunner(engine as Engine, image, launcher, () => name);
  await runner.run(timed(60), ["/bin/sh", "-c", ticks]);
}
