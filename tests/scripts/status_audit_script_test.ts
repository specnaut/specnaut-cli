import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { pathWithCrlfJq, pathWithoutJq } from "../templates/hooks/hook_path.ts";
import { ago, line, normalLedger, project, view } from "./status_audit_fixture.ts";

/**
 * `status-audit.sh` computes the seven session-health views (cli#679) that the
 * `/status-audit` skill used to ask the model to derive by hand. Each view's
 * rule was a sentence pinned in the skill (#381); it is pinned here as the
 * behaviour of the real script on a fixture ledger, which a sentence never was.
 * The skill keeps only what it still says: status_audit_skill_test.ts.
 *
 * Every passing case also requires a row only the computing path prints, so a
 * script that exits 0 having read nothing cannot pass.
 */

const HEADINGS = [
  "1. Health",
  "2. Per-agent",
  "3. Blocked",
  "4. Stale",
  "5. Contradictions",
  "6. Missing handoffs",
  "7. Verdict summary",
];

async function audit(lines: string[] | null, args: string[] = []) {
  const p = await project(lines);
  try {
    return await p.run(args);
  } finally {
    await p.cleanup();
  }
}

Deno.test("status-audit prints all seven views, in order, by their names", async () => {
  const r = await audit(normalLedger());
  assertEquals(r.code, 0, r.stderr);
  const at = HEADINGS.map((h) => r.stdout.search(new RegExp(`^${h.replace(".", "\\.")}`, "m")));
  assert(at.every((i) => i >= 0), `a view is missing:\n${r.stdout}`);
  assertEquals([...at].sort((a, b) => a - b), at, "the views are out of order");
  assertStringIncludes(r.stdout, "STATUS AUDIT — latest (whole ledger)");
});

Deno.test("1. Health counts the agents per latest state", async () => {
  const r = await audit(normalLedger());
  assertStringIncludes(
    view(r.stdout, 1),
    "  in_progress: 1, blocked: 1, awaiting_review: 1, awaiting_user: 1, done: 3\n",
  );
});

Deno.test("2. Per-agent: one row each — latest state, verdicts, last-update ts", async () => {
  const r = await audit(normalLedger());
  const v = view(r.stdout, 2);
  assertEquals(v.split("\n").filter((l) => l.startsWith("  ")).length, 7, v);
  assertStringIncludes(
    v,
    "  architect-expert · state done · review pass · qa unknown · last update ",
  );
  assertStringIncludes(v, "  qa-tester · state done · review unknown · qa fail · last update ");
});

Deno.test("the current state of an agent is its latest entry by ts, not by file order", async () => {
  const r = await audit(normalLedger());
  // The developer's `start` is the LAST line of its two, and the earlier ts.
  assertStringIncludes(view(r.stdout, 2), "  developer · state in_progress · ");
  assert(!view(r.stdout, 1).includes("unknown"), view(r.stdout, 1));
});

Deno.test("an absent optional field reads as unknown, never an error", async () => {
  const r = await audit([
    JSON.stringify({ ts: ago(1), event: "start", session: "s1", agent: "developer" }),
  ]);
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(view(r.stdout, 1), "  unknown: 1\n");
  assertStringIncludes(
    view(r.stdout, 2),
    "  developer · state unknown · review unknown · qa unknown · ",
  );
});

Deno.test("3. Blocked calls out each blocked agent as urgent", async () => {
  const v = view((await audit(normalLedger())).stdout, 3);
  assertStringIncludes(v, "  URGENT security-expert · blocked since ");
  assertEquals(v.split("\n").filter((l) => l.startsWith("  ")).length, 1, v);
});

Deno.test("4. Stale: a non-terminal agent with no entry for 15 minutes or more", async () => {
  const r = await audit([
    line({ ts: ago(16), agent: "developer", state: "in_progress" }),
    line({ ts: ago(14), agent: "product-owner", state: "awaiting_user" }),
    line({ ts: ago(60), agent: "architect-expert", state: "done" }),
    line({ ts: ago(60), agent: "qa-tester", state: "failed" }),
  ]);
  const v = view(r.stdout, 4);
  assertStringIncludes(v, "  developer · in_progress · no entry for 16 min (last ");
  for (const fresh of ["product-owner", "architect-expert", "qa-tester"]) {
    assert(!v.includes(fresh), `${fresh} is not stale:\n${v}`);
  }
});

Deno.test("5. Contradictions: state done but done_criteria_met no", async () => {
  const v = view((await audit(normalLedger())).stdout, 5);
  assertStringIncludes(v, "  qa-tester · state done but done_criteria_met no · ");
  assert(!v.includes("architect-expert"), v);
});

Deno.test("6. Missing handoffs: a handoff_target with no later entry in the session", async () => {
  const v = view((await audit(normalLedger())).stdout, 6);
  assertStringIncludes(
    v,
    "  product-owner → code-reviewer · session s1 · no later entry for code-reviewer\n",
  );
  // performance-expert handed off to architect-expert, which then ran.
  assert(!v.includes("performance-expert"), v);
});

Deno.test("6. a target that ran only in another session still counts as missing", async () => {
  const r = await audit([
    line({
      ts: ago(5),
      agent: "developer",
      state: "awaiting_review",
      handoff_target: "code-reviewer",
    }),
    line({ ts: ago(1), session: "s2", agent: "code-reviewer", state: "done" }),
  ]);
  assertStringIncludes(view(r.stdout, 6), "  developer → code-reviewer · session s1 · ");
});

Deno.test("7. Verdict summary counts review_verdict and qa_verdict across the scope", async () => {
  const v = view((await audit(normalLedger())).stdout, 7);
  assertStringIncludes(v, "  review_verdict: pass 1, fail 1, needs_followup 1\n");
  assertStringIncludes(v, "  qa_verdict: pass 0, fail 1, blocked 0\n");
});

Deno.test("the argument scopes the report to one agent, or to one session", async () => {
  const agent = await audit(normalLedger(), ["developer"]);
  assertStringIncludes(agent.stdout, "STATUS AUDIT — agent developer");
  assertEquals(view(agent.stdout, 2).split("\n").filter((l) => l.startsWith("  ")).length, 1);
  const session = await audit(normalLedger(), ["s2"]);
  assertStringIncludes(session.stdout, "STATUS AUDIT — session s2");
  assertStringIncludes(view(session.stdout, 2), "  dependency-expert · state done · ");
  assert(!view(session.stdout, 2).includes("developer ·"), session.stdout);
  const latest = await audit(normalLedger(), ["latest"]);
  assertStringIncludes(latest.stdout, "STATUS AUDIT — latest (whole ledger)");
});

Deno.test("no ledger yet — exit 0 with the message, for an absent or an empty file", async () => {
  for (const lines of [null, []]) {
    const r = await audit(lines);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "no ledger yet — no subagents have run in this project");
    assert(!r.stdout.includes("1. Health"), r.stdout);
  }
});

Deno.test("a malformed line is skipped with a note, by count, and the rest still reported", async () => {
  const r = await audit(["not json at all", ...normalLedger(), "{broken", "42"]);
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "skipped 3 malformed line(s)\n");
  assert(!r.stdout.includes("not json at all") && !r.stdout.includes("{broken"), r.stdout);
  assertStringIncludes(view(r.stdout, 3), "  URGENT security-expert");
});

Deno.test("usage: two arguments, or one outside the id charset, exit 2 with nothing on stdout", async () => {
  for (const args of [["a", "b"], ["$(id)"], ["dev loper"], ["x".repeat(65)]]) {
    const r = await audit(normalLedger(), args);
    assertEquals(r.code, 2, `${args}: ${r.stdout}`);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "usage: status-audit.sh [latest|<agent>|<session>]");
  }
});

Deno.test("jq missing → exit 3, never an empty report", async () => {
  const p = await project(normalLedger());
  try {
    const r = await p.run([], { PATH: await pathWithoutJq(p.sb) });
    assertEquals(r.code, 3, r.stdout);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "jq is required");
  } finally {
    await p.cleanup();
  }
});

Deno.test("an unreadable ledger → exit 3", async () => {
  const p = await project(null);
  try {
    await Deno.mkdir(join(p.dir, ".specnaut/logs/agents.jsonl"));
    const r = await p.run();
    assertEquals(r.code, 3, r.stdout);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "cannot read .specnaut/logs/agents.jsonl");
  } finally {
    await p.cleanup();
  }
});

Deno.test("a jq that writes CRLF (Windows jq.exe) yields the same report", async () => {
  const p = await project(normalLedger());
  try {
    const plain = await p.run();
    const crlf = await p.run([], { PATH: await pathWithCrlfJq(p.sb) });
    assertEquals(crlf.code, 0, crlf.stderr);
    assertEquals(crlf.stdout.replace(/ \d+ min/g, ""), plain.stdout.replace(/ \d+ min/g, ""));
    assert(!crlf.stdout.includes("\r"));
  } finally {
    await p.cleanup();
  }
});
