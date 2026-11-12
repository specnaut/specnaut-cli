import { assert, assertEquals } from "@std/assert";
import type { RunOutcome } from "../../src/application/sandbox_ports.ts";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import {
  type BackendProbe,
  chooseBackend,
  type OfferedBackend,
  type SandboxPolicy,
} from "../../src/domain/sandbox.ts";
import { CAP_NAMES, capsWithout, type SandboxLimits } from "../../src/domain/sandbox_limits.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import { deps, EXEC, MAC } from "../cli/sandbox_handler_fixture.ts";
import {
  killNamed,
  live,
  LIVE_IMAGE,
  probed,
  runIn,
  RUNNER_HOST,
  skipOf,
  STATUSES,
  withLayout,
} from "./sandbox_live_fixture.ts";

/**
 * The resource caps as `CAP_ENFORCEMENT` states them, checked against what each backend on this
 * host really stops. Per available backend and per cap, a bounded bomb runs under a cap lowered
 * below it: a cap the table says is enforced must stop it, and one it says is not must let it
 * finish and be reported (`UNCAPPED` on probe, the notice after exec). A wrong entry fails either
 * way. A backend this host does not offer is skipped with the probe's reason. The CPU cap has no
 * bomb: a quota slows a run without stopping it, which nothing here can judge without timing.
 */

type Cap = Exclude<keyof SandboxLimits, "cpus">;

/** A bomb: the lowered cap, the command, and whether its output shows it was stopped. */
type Bomb = {
  readonly what: string;
  readonly limits: Partial<SandboxLimits>;
  readonly command: string;
  readonly stopped: (outcome: RunOutcome, out: string, ms: number) => boolean;
};

const MIB = 1024 ** 2;
const count = (out: string, word: string) => out.split("\n").filter((l) => l === word).length;
/** A loop of `n` turns running `body` (ended by its own `;` or `&`), in any POSIX shell. */
const times = (n: number, body: string) =>
  `i=0; while [ $i -lt ${n} ]; do ${body} i=$((i+1)); done`;
/** The hang's wall clock: long enough for a container engine under load to start the run. */
const WALL = 15;
/** Long enough to outlive the wall clock and its grace, short enough to end on its own. */
const HANG = WALL + DRAIN_GRACE_SECONDS + 2;

const BOMBS: Readonly<Record<Cap, Bomb>> = {
  memoryBytes: {
    what: "a multi-process memory bomb (4 x 32 MiB held at once, cap 64 MiB)",
    limits: { memoryBytes: 64 * MIB },
    command: times(4, "(x=$(head -c 33554432 /dev/zero | tr '\\0' a); sleep 3; echo held) &") +
      "; wait",
    stopped: (_, out) => count(out, "held") < 4,
  },
  processes: {
    what: "a fork bomb (40 processes, cap 16)",
    limits: { processes: 16 },
    command: times(40, "(echo up; sleep 3) &") + "; wait",
    stopped: (_, out) => count(out, "up") < 40,
  },
  scratchBytes: {
    what: "a multi-file scratch fill (4 x 4 MiB, cap 8 MiB)",
    limits: { scratchBytes: 8 * MIB },
    command: times(4, 'head -c 4194304 /dev/zero > "$TMPDIR/f$i" && echo wrote;'),
    stopped: (_, out) => count(out, "wrote") < 4,
  },
  wallClockSeconds: {
    what: `a detaching hang (${HANG} s, wall clock ${WALL} s)`,
    limits: { wallClockSeconds: WALL },
    command:
      `if command -v setsid >/dev/null; then setsid sleep ${HANG}.5 & else (sleep ${HANG}.5 &); fi; ` +
      `sleep ${HANG}.5`,
    stopped: (outcome, _, ms) =>
      outcome.kind === "timed_out" && ms < (WALL + DRAIN_GRACE_SECONDS + 1) * 1000,
  },
};

/**
 * The probe lines and the exec notice for `offered` on a host `probe` describes, through the
 * handler, as a user sees them.
 */
async function reported(
  probe: BackendProbe,
  offered: OfferedBackend,
  outcome: RunOutcome,
): Promise<string[]> {
  const ran = {
    kind: "ran" as const,
    backend: offered.kind,
    outcome,
    unenforced: capsWithout(offered),
  };
  const { d, out, err } = deps(probe, () => Promise.resolve(ran));
  await runSandbox({ kind: "sandbox", sub: "probe" }, d);
  await runSandbox(EXEC, d);
  return [...out.join("\n").split("\n"), ...err];
}

/** Asserts `lines` report `cap` UNCAPPED on `backend`, on probe and in the exec notice. */
function assertUncapped(lines: string[], backend: string, cap: keyof SandboxLimits): void {
  const uncapped = (prefix: string) =>
    lines.some((l) =>
      l.startsWith(`${prefix}UNCAPPED ${backend} `) &&
      l.split(" ").at(-1)!.split(",").includes(CAP_NAMES[cap])
    );
  assert(uncapped(""), `no UNCAPPED line on probe: ${lines.join(" | ")}`);
  assert(uncapped("notice: specnaut sandbox exec: "), `no exec notice: ${lines.join(" | ")}`);
}

/** A Linux host whose docker daemon can apply every limit, with a pinned image to run. */
const DOCKER_HOST: BackendProbe = {
  ...MAC,
  os: "linux",
  sandboxExec: false,
  docker: true,
  image: { kind: "pinned", ref: `acme/dev@sha256:${"e".repeat(64)}` },
};

/** The cap each limit docker reports carries. */
const DOCKER_CAPS = {
  memory: "memoryBytes",
  swap: "memoryBytes",
  pids: "processes",
  cpuQuota: "cpus",
} as const;

Deno.test("caps: on docker whose host cannot apply a limit, its cap is reported UNCAPPED", async () => {
  for (const [limit, cap] of Object.entries(DOCKER_CAPS)) {
    const probe = { ...DOCKER_HOST, dockerLimits: { ...DOCKER_HOST.dockerLimits, [limit]: false } };
    const offered = chooseBackend(probe);
    assertEquals(offered.kind, "container", limit);
    const lines = await reported(probe, offered as OfferedBackend, { kind: "exited", code: 0 });
    assertUncapped(lines, "container", cap);
  }
});

for (const status of STATUSES) {
  const missing = skipOf(status);
  for (const cap of Object.keys(BOMBS) as Cap[]) {
    const bomb = BOMBS[cap];
    const offered = "offered" in status ? status.offered : null;
    const enforced = offered !== null && !capsWithout(offered).includes(cap);
    const claim = enforced ? "is stopped" : "runs to its end and is reported UNCAPPED";
    Deno.test({
      name: live(`caps live: on ${status.kind}, ${bomb.what} ${claim}`, missing),
      ignore: missing !== null,
      fn: () =>
        withLayout(status.kind, async ({ policy }) => {
          const capped: SandboxPolicy = {
            ...policy,
            limits: { ...policy.limits, wallClockSeconds: 120, ...bomb.limits },
          };
          const started = Date.now();
          try {
            const { outcome, out } = await runIn(
              (l) => runnerFor(offered!, l, RUNNER_HOST),
              capped,
              ["/bin/sh", "-c", `echo start; ${bomb.command}`],
            );
            const detail = JSON.stringify({ outcome, out: out.slice(0, 200) });
            // Only the bomb's own shell prints it: a run that never started proves nothing.
            assert(out.startsWith("start\n"), `the bomb never ran: ${detail}`);
            assertEquals(bomb.stopped(outcome, out, Date.now() - started), enforced, detail);
            if (enforced) return;
            const probe = { ...probed, image: { kind: "pinned", ref: LIVE_IMAGE } } as const;
            assertUncapped(await reported(probe, offered!, outcome), status.kind, cap);
          } finally {
            killNamed(`sleep ${HANG}.5`);
            killNamed(`setsid sleep ${HANG}.5`);
          }
        }),
    });
  }
}
