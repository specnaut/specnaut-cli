import type { RunOutcome } from "../../src/application/sandbox_ports.ts";
import type { ReportedCap, SandboxLimits } from "../../src/domain/sandbox_limits.ts";
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

/**
 * A unit's line once it ran to its end, a line only the cap's refusal of one prints, and how many
 * units at most can run to their end beside the cap: a refusal after more did is not the cap's.
 */
type Marks = {
  readonly units: number;
  readonly done: RegExp;
  readonly capped: RegExp;
  readonly atMost: number;
};

/**
 * The `sh: 2: ` dash puts before an error, written apart from the message: another unit's line can
 * land between the two, so the prefix is taken off and what follows it judged on its own. The
 * message still shows up on a line of its own, and is judged there.
 */
const SHELL_ERROR_PREFIX = /^(?:\/bin\/)?sh: \d+: /;

/** The verdict on `out` under `marks`: any line neither marks is unexplained. */
export function judged(out: string, marks: Marks): Verdict {
  const lines = out.split("\n").map((l) => l.replace(SHELL_ERROR_PREFIX, ""))
    .filter((l) => l !== "" && l !== START);
  const odd = lines.filter((l) => !marks.done.test(l) && !marks.capped.test(l));
  if (odd.length > 0) return `unexplained: ${odd.slice(0, 3).join(" | ")}`;
  const done = new Set(lines.filter((l) => marks.done.test(l))).size;
  if (lines.some((l) => marks.capped.test(l))) {
    return done <= marks.atMost ? "stopped" : `unexplained: ${done} units ran beside the cap`;
  }
  return done === marks.units ? "finished" : `unexplained: ${done} of ${marks.units} units ran`;
}

const MIB = 1024 ** 2;
/** A loop of `n` turns running `body` (ended by its own `;` or `&`), in any POSIX shell. */
const times = (n: number, body: string) =>
  `i=0; while [ $i -lt ${n} ]; do ${body} i=$((i+1)); done`;

/**
 * The barrier the units wait on: a FIFO held open on descriptor 3, so a unit blocks in `read`
 * without a process or a timer of its own, until {@link release} writes it a line. Every unit is
 * then alive at once, however slowly the host started them. `go` and `ev` are made in the scratch.
 */
const BARRIER = 'exec 2>&1; cd "$TMPDIR" && mkfifo go ev && exec 3<>go 4<>ev || exit 4; ';
const AWAIT = "read -r g <&3";
/** One line on the barrier per unit: each unit takes one, whenever it reaches it. */
const release = (n: number) => `{ ${times(n, "echo;")} >&3; }`;

/** The hang's wall clock: long enough for a container engine under load to start the run. */
export const WALL = 15;
/**
 * By when a stopped run has ended: the wall clock, the drain grace, and ample time for the
 * engine to start the run, stop it and remove it on a loaded host.
 */
export const STOP_BY = WALL + DRAIN_GRACE_SECONDS + 30;
/** Far past `STOP_BY`, so a hang the wall clock missed is never taken for one it stopped. */
export const HANG = STOP_BY + 30;

/**
 * Each unit holds 32 MiB in its shell, checks it holds it all, says so (`held`), and waits at the
 * barrier; a wrapper reports its exit status. The barrier opens once every unit held or ended:
 * `seen` counts each unit once, so one ended after it held cannot open it early.
 */
const HOLD = "( (x=$(head -c 33554432 /dev/zero | tr '\\0' a) || exit $?; " +
  `[ "\${#x}" -eq 33554432 ] || exit 3; echo "held $i" >&4; ${AWAIT}); echo "unit $i $?" >&4) &`;
const SETTLE = 'n=0; e=0; seen=" "; while [ $e -lt 4 ] && read -r w u s <&4; do ' +
  '[ "$w" = unit ] && { echo "unit $u $s"; e=$((e+1)); }; [ "$s" != 0 ] || continue; ' +
  `case "$seen" in *" $u "*) ;; *) seen="$seen$u "; n=$((n+1)); ` +
  `[ $n -eq 4 ] && ${release(4)};; esac; done`;

/** What `head` prints when its write to a full scratch file fails, in GNU and in busybox. */
const FULL = /No space left on device|^head: standard output: I\/O error$/;

export const BOMBS: Readonly<Record<Cap, Bomb>> = {
  memoryBytes: {
    what: "a multi-process memory bomb (4 x 32 MiB held at once, cap 64 MiB)",
    limits: { memoryBytes: 64 * MIB },
    command: `${BARRIER}${times(4, HOLD)}; ${SETTLE}`,
    // A unit the cap ends is killed (137); a shell may also say so of its job. At most one unit
    // fits in the cap with its shell. A host OOM kill that leaves no more than one is not told
    // from the cap's: the memory cgroup's own count of kills is out of the run's reach.
    verdict: (_, out) =>
      judged(out, { units: 4, done: /^unit \d+ 0$/, capped: /^unit \d+ 137$|Killed/, atMost: 1 }),
  },
  processes: {
    what: "a fork bomb (40 processes, cap 16)",
    limits: { processes: 16 },
    command: `${BARRIER}${times(40, `(echo "up $i"; ${AWAIT}) &`)}; ${release(40)}; wait`,
    // Every shell names `fork` when it is refused one: "Cannot fork", "can't fork", "fork: ...".
    // Fewer than 16 units can be up under the cap, the shell counted. A host RLIMIT_NPROC that
    // refuses a fork before 16 is not told from the cap: both are the same EAGAIN.
    verdict: (_, out) => judged(out, { units: 40, done: /^up \d+$/, capped: /fork/i, atMost: 15 }),
  },
  scratchBytes: {
    what: "a multi-file scratch fill (4 x 4 MiB, cap 8 MiB)",
    limits: { scratchBytes: 8 * MIB },
    command: "exec 2>&1; " +
      times(4, 'head -c 4194304 /dev/zero > "$TMPDIR/f$i" && echo "wrote $i";'),
    // A write refused for want of space: GNU head names it, busybox's says only "I/O error". At
    // most two 4 MiB files fit in the 8 MiB cap.
    verdict: (_, out) => judged(out, { units: 4, done: /^wrote \d+$/, capped: FULL, atMost: 2 }),
  },
  wallClockSeconds: {
    what:
      `a sleep past the wall clock, beside a background one (${HANG}.5 s each, wall clock ${WALL} s)`,
    limits: { wallClockSeconds: WALL },
    command:
      `if command -v setsid >/dev/null; then setsid sleep ${HANG}.5 & else (sleep ${HANG}.5 &); fi; ` +
      `sleep ${HANG}.5`,
    verdict: (outcome, out, ms) => {
      if (out !== `${START}\n`) return `unexplained: ${out.slice(0, 200)}`;
      // Stopped no sooner than the wall clock allows: an earlier `timed_out` is not its doing.
      const inTime = ms >= WALL * 1000 && ms < STOP_BY * 1000;
      if (outcome.kind === "timed_out" && inTime) return "stopped";
      if (outcome.kind === "exited" && outcome.code === 0) return "finished";
      return `unexplained: ${JSON.stringify(outcome)} after ${ms} ms`;
    },
  },
};

/**
 * The verdicts the run of `cap`'s bomb may end with on a backend that runs without `without`:
 * finished where the cap is not enforced, else stopped. The memory cap of an engine whose host
 * cannot bound paged-out memory still binds what a run holds, but a host that pages the bomb out
 * lets it finish: there the case depends on the host, and either verdict is taken.
 */
export function expectedVerdicts(cap: Cap, without: readonly ReportedCap[]): Verdict[] {
  if (without.includes(cap)) return ["finished"];
  if (cap === "memoryBytes" && without.includes("memorySwap")) return ["stopped", "finished"];
  return ["stopped"];
}
