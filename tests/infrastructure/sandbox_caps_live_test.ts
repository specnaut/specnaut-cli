import { assert, assertEquals } from "@std/assert";
import { execInSandbox } from "../../src/application/sandbox_exec.ts";
import type { RunOutcome } from "../../src/application/sandbox_ports.ts";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import type {
  BackendProbe,
  OfferedBackend,
  SandboxedBackend,
  SandboxPolicy,
} from "../../src/domain/sandbox.ts";
import { CAP_NAMES, capsWithout, type SandboxLimits } from "../../src/domain/sandbox_limits.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { deps, EXEC, MAC } from "../cli/sandbox_handler_fixture.ts";
import { PATHS } from "../domain/sandbox_fixture.ts";
import { type Bomb, BOMBS, type Cap, HANG, START } from "./sandbox_caps_bombs.ts";
import {
  killNamed,
  live,
  LIVE_IMAGE,
  probed,
  type Run,
  runIn,
  RUNNER_HOST,
  skipOf,
  STATUSES,
  withLayout,
} from "./sandbox_live_fixture.ts";

/**
 * The resource caps as `CAP_ENFORCEMENT` states them, checked against what each backend on this
 * host really stops. Per available backend and per cap, a bounded bomb (`sandbox_caps_bombs.ts`)
 * runs under a cap lowered below it: a cap the table says is enforced must stop it, and one it
 * says is not must let it finish and be reported (`UNCAPPED` on probe, the notice after exec). A
 * wrong entry fails either way. A backend this host does not offer is skipped with the probe's
 * reason. The CPU cap has no bomb: a quota slows a run without stopping it, which nothing here can
 * judge without timing.
 */

/** `probe` with every backend ahead of `kind` taken away, so that a run's choice is `kind`. */
function only(probe: BackendProbe, kind: SandboxedBackend): BackendProbe {
  if (kind === "container") return probe;
  const noContainer = { ...probe, podman: "absent", docker: false } as const;
  return kind === "bwrap" ? noContainer : { ...noContainer, bwrap: "absent" };
}

/**
 * The probe lines and the exec notice on a host `probe` describes, through the handler and
 * `execInSandbox` as a user's run goes, its runner standing in with `outcome`.
 */
async function reported(probe: BackendProbe, outcome: RunOutcome): Promise<string[]> {
  const scratch = { path: PATHS.scratch, remove: () => Promise.resolve() };
  const exec = () =>
    execInSandbox({
      prober: { probe: () => Promise.resolve(probe) },
      host: {
        locate: () => Promise.resolve({ ...PATHS }),
        real: (folders) => Promise.resolve([...folders]),
        scratch: () => Promise.resolve(scratch),
      },
      runnerFor: () => ({ run: () => Promise.resolve(outcome) }),
    }, { sha: "a".repeat(40), toolchain: [], command: ["true"] });
  const { d, out, err } = deps(probe, exec);
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
    assertUncapped(await reported(probe, { kind: "exited", code: 0 }), "container", cap);
  }
});

/** `bomb` run on `offered` under `policy` with its cap lowered: how it ended, what it printed. */
async function detonate(offered: OfferedBackend, policy: SandboxPolicy, bomb: Bomb) {
  const capped = { ...policy, limits: { ...policy.limits, wallClockSeconds: 120, ...bomb.limits } };
  const started = Date.now();
  try {
    const command = ["/bin/sh", "-c", `echo ${START}; ${bomb.command}`];
    const run = await runIn((l) => runnerFor(offered, l, RUNNER_HOST), capped, command);
    return { ...run, verdict: bomb.verdict(run.outcome, run.out, Date.now() - started) };
  } finally {
    killNamed(`sleep ${HANG}.5`);
    killNamed(`setsid sleep ${HANG}.5`);
  }
}

/** Runs `cap`'s bomb on `offered`: stopped where the table enforces it, else run and reported. */
async function checkCap(offered: OfferedBackend, cap: Cap, { policy }: Run): Promise<void> {
  const enforced = !capsWithout(offered).includes(cap);
  const { outcome, out, verdict } = await detonate(offered, policy, BOMBS[cap]);
  const detail = JSON.stringify({ outcome, out: out.slice(0, 400) });
  // Only the bomb's own shell prints it: a run that never started proves nothing.
  assert(out.startsWith(`${START}\n`), `the bomb never ran: ${detail}`);
  assertEquals(verdict, enforced ? "stopped" : "finished", detail);
  if (enforced) return;
  const probe = only({ ...probed, image: { kind: "pinned", ref: LIVE_IMAGE } }, offered.kind);
  assertUncapped(await reported(probe, outcome), offered.kind, cap);
}

for (const status of STATUSES) {
  const missing = skipOf(status);
  const offered = "offered" in status ? status.offered : null;
  for (const cap of Object.keys(BOMBS) as Cap[]) {
    const enforced = offered !== null && !capsWithout(offered).includes(cap);
    const claim = enforced ? "is stopped" : "runs to its end and is reported UNCAPPED";
    Deno.test({
      name: live(`caps live: on ${status.kind}, ${BOMBS[cap].what} ${claim}`, missing),
      ignore: missing !== null,
      fn: () => withLayout(status.kind, (run) => checkCap(offered!, cap, run)),
    });
  }
}
