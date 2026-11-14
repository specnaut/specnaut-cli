// SC-002 and SC-004 of spec 061. Every case of the corpus runs on the bash twin
// and, where pwsh exists, on the PowerShell twin in the same repository: each must
// run what the case says must run, and the two must print the same report and exit
// the same. Skipped for the second twin where pwsh is absent; CI's Windows job has it.

import { assert, assertEquals } from "@std/assert";
import { type Case, CORPUS } from "./gate_impact_corpus.ts";
import { impactRepo, labelled, type Report } from "./gate_impact_fixture.ts";
import { type Twin, TWINS } from "./run_gate_fixture.ts";

function assertCase(c: Case, r: Report, twin: string) {
  const where = `${twin}\n${r.stdout}\n${r.stderr}`;
  assertEquals(r.code, c.code, where);
  if (c.scope !== undefined) assertEquals(labelled(r, "scope"), [c.scope], where);
  if (c.fallback !== undefined) {
    assertEquals(labelled(r, "fallback").length, 1, where);
    assert(labelled(r, "fallback")[0].startsWith(c.fallback), where);
  } else assertEquals(labelled(r, "fallback"), ["none"], where);
  assertEquals(r.marks, c.marks, where);
  assertEquals(labelled(r, "removed"), c.removed ?? ["none"], where);
}

const WINDOWS = Deno.build.os === "windows";
const ACTIVE = CORPUS.filter((c) => !(c.posixOnly === true && WINDOWS));

/** One case on every twin, in one repository; what each reported. */
async function runCase(c: Case): Promise<{ reports: Report[]; twins: Twin[]; worktrees: number }> {
  const repo = await impactRepo(c.repo);
  const invocation = (await c.build(repo)) ?? {};
  const args = invocation.args ?? ["fast", "--base", repo.main];
  const reports: Report[] = [];
  for (const twin of TWINS) {
    reports.push(await repo.gate(twin, args, { stdin: invocation.stdin }));
  }
  return { reports, twins: TWINS, worktrees: await repo.worktrees() };
}

// Each case takes seconds on pwsh, so the corpus runs on a small pool the first test
// starts, and each test reads its own case's answer. The cases share nothing on disk.
let started: Map<string, Promise<Awaited<ReturnType<typeof runCase>>>> | undefined;
function results() {
  if (started) return started;
  const map = new Map<string, Promise<Awaited<ReturnType<typeof runCase>>>>();
  const queue = [...ACTIVE];
  const resolvers = new Map<string, (v: Promise<Awaited<ReturnType<typeof runCase>>>) => void>();
  for (const c of ACTIVE) {
    const answer = new Promise<Awaited<ReturnType<typeof runCase>>>((res) =>
      resolvers.set(c.name, res)
    );
    // A case whose test `--filter` skipped is still run, and no test awaits its answer: its failure
    // (its folder removed under it at unload) is nobody's verdict. A test awaiting it still sees it.
    answer.catch(() => {});
    map.set(c.name, answer);
  }
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const running = runCase(c);
      resolvers.get(c.name)!(running);
      // A failing case reaches its own test, which awaits this same promise.
      await running.catch(() => {});
    }
  };
  for (let i = 0; i < Math.max(2, navigator.hardwareConcurrency - 1); i++) worker();
  started = map;
  return map;
}

// Stated, not silent: on bash alone each case still runs, but no two twins are compared.
// `pwshRunsOnCi` in gate_impact_candidate_test.ts fails a CI run where this would skip.
Deno.test({
  name: "gate impact: the twins are compared (ignored only where pwsh is absent)",
  ignore: TWINS.length === 1,
  fn: () => assertEquals(TWINS, ["bash", "pwsh"]),
});

Deno.test("gate impact: every case of the corpus has a name of its own", () => {
  assertEquals(new Set(CORPUS.map((c) => c.name)).size, CORPUS.length);
});

for (const c of CORPUS) {
  Deno.test({
    name: `gate impact: ${c.name}`,
    ignore: c.posixOnly === true && WINDOWS,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const { reports, twins, worktrees } = await results().get(c.name)!;
      reports.forEach((r, i) => assertCase(c, r, twins[i]));
      if (reports.length === 2) {
        assertEquals(reports[1].report, reports[0].report, "the twins disagree");
        assertEquals(reports[1].marks, reports[0].marks, "the twins ran different commands");
      }
      assertEquals(worktrees, 1, "a temporary worktree stayed behind");
    },
  });
}
