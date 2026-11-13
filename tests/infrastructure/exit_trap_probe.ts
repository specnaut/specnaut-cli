import { armExitTrap } from "../../src/infrastructure/exit_trap.ts";

/**
 * A process for `exit_trap_test.ts`: arms three traps, `first`, `second` and `third`, disarms the
 * second, prints `armed`, then ends as asked (`exit`, or `signal`: it waits to be stopped). Each
 * trap prints its name when it runs.
 */
const [how] = Deno.args;
const traps = ["first", "second", "third"].map((name) => armExitTrap(() => console.log(name)));
traps[1]();
console.log("armed");
if (how === "exit") Deno.exit(0);
if (how === "signal") await new Promise((done) => setTimeout(done, 60_000));
