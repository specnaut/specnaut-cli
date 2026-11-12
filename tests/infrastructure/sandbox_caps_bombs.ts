import type { RunOutcome } from "../../src/application/sandbox_ports.ts";
import type { SandboxLimits } from "../../src/domain/sandbox_limits.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";

/**
 * The bombs of the resource-cap suite: per cap, a bounded run of units that a cap lowered below it
 * must stop. Each prints its errors with its output, and each line it prints is accounted for: a
 * unit that ran to its end, or the cap refusing one. A line that is neither is a failure the cap
 * did not cause, and the verdict says so instead of passing it off as the cap at work.
 */

export type Cap = Exclude<keyof SandboxLimits, "cpus">;

/** The cap stopped the run, every unit ran to its end, or what the output does not account for. */
export type Verdict = "stopped" | "finished" | `unexplained: ${string}`;

/** A bomb: the lowered cap, the command, and the verdict on what it printed and how it ended. */
export type Bomb = {
  readonly what: string;
  readonly limits: Partial<SandboxLimits>;
  readonly command: string;
  readonly verdict: (outcome: RunOutcome, out: string, ms: number) => Verdict;
};

/** The marker the bomb's own shell prints first: a run without it never started. */
export const START = "start";

/** A unit's line once it ran to its end, and a line only the cap's refusal of one prints. */
type Marks = { readonly units: number; readonly done: RegExp; readonly capped: RegExp };

/** The verdict on `out` under `marks`: any line neither marks is unexplained. */
export function judged(out: string, marks: Marks): Verdict {
  const lines = out.split("\n").filter((l) => l !== "" && l !== START);
  const odd = lines.filter((l) => !marks.done.test(l) && !marks.capped.test(l));
  if (odd.length > 0) return `unexplained: ${odd.slice(0, 3).join(" | ")}`;
  if (lines.some((l) => marks.capped.test(l))) return "stopped";
  const done = new Set(lines.filter((l) => marks.done.test(l))).size;
  return done === marks.units ? "finished" : `unexplained: ${done} of ${marks.units} units ran`;
}

const MIB = 1024 ** 2;
/** A loop of `n` turns running `body` (ended by its own `;` or `&`), in any POSIX shell. */
const times = (n: number, body: string) =>
  `exec 2>&1; i=0; while [ $i -lt ${n} ]; do ${body} i=$((i+1)); done`;

/** The hang's wall clock: long enough for a container engine under load to start the run. */
export const WALL = 15;
/**
 * By when a stopped run has ended: the wall clock, the drain grace, and ample time for the
 * engine to start the run, stop it and remove it on a loaded host.
 */
export const STOP_BY = WALL + DRAIN_GRACE_SECONDS + 30;
/** Far past `STOP_BY`, so a hang the wall clock missed is never taken for one it stopped. */
export const HANG = STOP_BY + 30;

/** Each unit holds 32 MiB in its shell, checks it holds it all, and reports its exit status. */
const HOLD = "(x=$(head -c 33554432 /dev/zero | tr '\\0' a) || exit $?; " +
  '[ "${#x}" -eq 33554432 ] || exit 3; sleep 3) & pids="$pids $!";';

export const BOMBS: Readonly<Record<Cap, Bomb>> = {
  memoryBytes: {
    what: "a multi-process memory bomb (4 x 32 MiB held at once, cap 64 MiB)",
    limits: { memoryBytes: 64 * MIB },
    command: `pids=""; ${times(4, HOLD)}; ` +
      'i=0; for p in $pids; do wait "$p"; echo "unit $i $?"; i=$((i+1)); done',
    // A unit the cap ends is killed (137); a shell may also say so of its job.
    verdict: (_, out) =>
      judged(out, { units: 4, done: /^unit \d+ 0$/, capped: /^unit \d+ 137$|Killed/ }),
  },
  processes: {
    what: "a fork bomb (40 processes, cap 16)",
    limits: { processes: 16 },
    command: times(40, '(echo "up $i"; sleep 3) &') + "; wait",
    // Every shell names `fork` when it is refused one: "Cannot fork", "can't fork", "fork: ...".
    verdict: (_, out) => judged(out, { units: 40, done: /^up \d+$/, capped: /fork/i }),
  },
  scratchBytes: {
    what: "a multi-file scratch fill (4 x 4 MiB, cap 8 MiB)",
    limits: { scratchBytes: 8 * MIB },
    command: times(4, 'head -c 4194304 /dev/zero > "$TMPDIR/f$i" && echo "wrote $i";'),
    verdict: (_, out) =>
      judged(out, { units: 4, done: /^wrote \d+$/, capped: /No space left on device/ }),
  },
  wallClockSeconds: {
    what: `a detaching hang (${HANG} s, wall clock ${WALL} s)`,
    limits: { wallClockSeconds: WALL },
    command:
      `if command -v setsid >/dev/null; then setsid sleep ${HANG}.5 & else (sleep ${HANG}.5 &); fi; ` +
      `sleep ${HANG}.5`,
    verdict: (outcome, out, ms) => {
      if (out !== `${START}\n`) return `unexplained: ${out.slice(0, 200)}`;
      if (outcome.kind === "timed_out" && ms < STOP_BY * 1000) return "stopped";
      if (outcome.kind === "exited" && outcome.code === 0) return "finished";
      return `unexplained: ${JSON.stringify(outcome)} after ${ms} ms`;
    },
  },
};
