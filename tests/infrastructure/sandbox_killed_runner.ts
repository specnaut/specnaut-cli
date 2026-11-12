import { join } from "@std/path";
import { sandboxPolicy } from "../../src/domain/sandbox.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";

/**
 * A stand-in for the CLI, for the live test that kills it with SIGKILL: it runs `/bin/sleep
 * <seconds>` through the seatbelt runner, under a one-second wall clock, in folders made under
 * `<base>` (so the test can remove what a killed process cannot). Not a test file.
 */

const [base, seconds] = Deno.args;
const tree = join(base, "tree");
const scratch = join(base, "scratch");
await Deno.mkdir(tree);
await Deno.mkdir(scratch);
const result = sandboxPolicy("seatbelt", {
  tree,
  scratch,
  toolchain: [],
  path: [],
  home: await Deno.realPath(Deno.env.get("HOME")!),
  checkout: join(base, "checkout"),
});
if (!result.ok) throw new Error(result.why);
const policy = { ...result.policy, limits: { ...result.policy.limits, wallClockSeconds: 1 } };
await new SeatbeltRunner(new DenoProcessLauncher()).run(policy, ["/bin/sleep", seconds]);
