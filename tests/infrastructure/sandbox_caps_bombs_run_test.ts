import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BOMBS } from "./sandbox_caps_bombs.ts";
import { POSIX } from "./sandbox_runner_fixture.ts";

/**
 * The memory bomb run by the host's own shell, with no sandbox and no wall clock: a unit killed
 * whole before it held, its wrapper included, so that it never says a word, still lets the run
 * end on its own. What the run waits on is each unit holding or ending, then the wrappers ending,
 * never a count of the lines the units print.
 */

/** How long the bomb may take here: far past its run time, short of a hang. */
const BOUND_MS = 60_000;

/**
 * A `tr` whose first caller loses its unit: it kills, outermost first, every process between
 * itself and the bomb's shell (`$BOMB`), the wrapper that would print the unit's status included.
 * Every later caller is the real `tr`. What it killed, and the run's processes left after, are
 * appended to `lost/tree` under the caller's own pid: CI has twice seen two units lost, with two of
 * these callers left in the record step, and a second record written over the first hid the
 * other's walk. Each record now stays, so a run that loses more than one unit says how.
 */
const LOSING_TR = `#!/bin/sh
if mkdir "$TMPDIR/lost" 2>/dev/null; then
  p=$PPID; unit=
  while [ "$p" -ne "$BOMB" ] && [ "$p" -gt 1 ]; do unit="$p $unit"; p=$(($(ps -o ppid= -p "$p"))); done
  kill -9 $unit
  { echo "tr $$ bomb $BOMB killed $unit"; ps -axo pid=,ppid=,args= | grep -F -- "$TMPDIR"; } >>"$TMPDIR/lost/tree" 2>&1
  exit 0
fi
exec /usr/bin/tr "$@"
`;

Deno.test({
  name: "memory bomb: a unit lost without a word ends the run, not the wall clock",
  ignore: !POSIX,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-bomb-" });
    try {
      await Deno.mkdir(join(dir, "bin"));
      await Deno.writeTextFile(join(dir, "bin", "tr"), LOSING_TR, { mode: 0o755 });
      const child = new Deno.Command("/bin/sh", {
        // The folder named in the script marks every process of the run, as `ps` lists them.
        args: ["-c", `BOMB=$$; export BOMB; : '${dir}'; ${BOMBS.memoryBytes.command}`],
        env: { PATH: `${join(dir, "bin")}:/usr/bin:/bin`, TMPDIR: dir },
        clearEnv: true,
        stdout: "piped",
        stderr: "inherit",
      }).spawn();
      const timer = setTimeout(() => killMarked(dir), BOUND_MS);
      const { success, signal, stdout } = await child.output().finally(() => clearTimeout(timer));
      const out = new TextDecoder().decode(stdout);
      assertEquals(signal, null, `still running after ${BOUND_MS} ms, killed: ${out}`);
      assert(success, out);
      assert(Deno.statSync(join(dir, "lost")).isDirectory, "no unit was lost");
      assertReported(out, await Deno.readTextFile(join(dir, "lost", "tree")).catch(String));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

/**
 * What the run is held to beside ending on its own: every unit it still reports ran to its end,
 * once, and the lost ones are left out. How many the fixture loses is its own: one by design, two
 * on CI twice with the cause open, which each record in `tree` is there to tell.
 */
function assertReported(out: string, tree: string): void {
  const units = out.split("\n").filter((l) => l.startsWith("unit "));
  const seen = `${out}\n${tree}`;
  assert(units.length >= 1 && units.length <= 3, seen);
  assert(units.every((l) => /^unit [0-3] 0$/.test(l)), seen);
  assertEquals(new Set(units).size, units.length, seen);
}

/**
 * Kills every process whose command line names `marker`: the bomb's shell and each of its units,
 * whose output would otherwise keep the run's pipe open past the kill of the shell alone.
 */
function killMarked(marker: string): void {
  const ps = new Deno.Command("ps", { args: ["-axo", "pid=,command="] }).outputSync();
  for (const line of new TextDecoder().decode(ps.stdout).split("\n")) {
    const [, pid, cmd] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    if (!cmd?.includes(marker) || Number(pid) === Deno.pid) continue;
    try {
      Deno.kill(Number(pid), "SIGKILL");
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
}
