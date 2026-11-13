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
 * Every later caller is the real `tr`.
 */
const LOSING_TR = `#!/bin/sh
if mkdir "$TMPDIR/lost" 2>/dev/null; then
  p=$PPID; unit=
  while [ "$p" -ne "$BOMB" ] && [ "$p" -gt 1 ]; do unit="$p $unit"; p=$(($(ps -o ppid= -p "$p"))); done
  kill -9 $unit
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
      const units = out.split("\n").filter((l) => l.startsWith("unit "));
      assertEquals(units.length, 3, out);
      assert(units.every((l) => / 0$/.test(l)), out);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

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
