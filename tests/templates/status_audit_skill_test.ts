import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the `/status-audit` skill contract into the bundled SKILL.md so it
 * can't drift silently (#381). The skill is read-only and reports the SEVEN
 * health views over `.specflow/logs/agents.jsonl`; the load-bearing
 * instructions — the seven views, the `/loop 5m /status-audit` supervision
 * pattern, the read-only guarantee, and the graceful-degradation rules — must
 * survive every edit.
 *
 * Contract: contracts/status-report.md + data-model.md.
 */

const SKILL = CORE_BUNDLE.find(
  (e: CoreEntry) => e.category === "skill" && e.name === "status-audit",
);

Deno.test("status-audit SKILL.md is bundled in CORE_BUNDLE", () => {
  assert(SKILL, "expected a `skill` entry named status-audit in CORE_BUNDLE");
});

Deno.test("status-audit SKILL reads the ledger and is read-only", () => {
  assert(SKILL);
  const body = SKILL.content;
  assertStringIncludes(body, ".specflow/logs/agents.jsonl");
  assertStringIncludes(body, "read-only");
  assertStringIncludes(body, "git status` is unchanged");
});

Deno.test("status-audit SKILL documents all seven report views", () => {
  assert(SKILL);
  const body = SKILL.content;
  // 1. Health (per-state counts)
  assertStringIncludes(body, "Health");
  assertStringIncludes(body, "count of agents per `state`");
  // 2. Per-agent latest
  assertStringIncludes(body, "Per-agent");
  assertStringIncludes(body, "last-update `ts`");
  // 3. Blocked (urgent)
  assertStringIncludes(body, "Blocked");
  assertStringIncludes(body, "urgent");
  // 4. Stale ≥ 15 min
  assertStringIncludes(body, "Stale");
  assertStringIncludes(body, "15 minutes");
  // 5. Contradictions (done + done_criteria_met:no)
  assertStringIncludes(body, "Contradictions");
  assertStringIncludes(body, "state: done");
  assertStringIncludes(body, "done_criteria_met: no");
  // 6. Missing handoffs
  assertStringIncludes(body, "Missing handoffs");
  assertStringIncludes(body, "handoff_target");
  // 7. Verdict summary
  assertStringIncludes(body, "Verdict summary");
  assertStringIncludes(body, "review_verdict");
  assertStringIncludes(body, "qa_verdict");
});

Deno.test("status-audit SKILL derives current state as latest entry by ts", () => {
  assert(SKILL);
  assertStringIncludes(
    SKILL.content,
    "current state of an agent is its latest entry by `ts`",
  );
});

Deno.test("status-audit SKILL documents the /loop 5m supervision pattern", () => {
  assert(SKILL);
  assertStringIncludes(SKILL.content, "/loop 5m /status-audit");
});

Deno.test("status-audit SKILL encodes the graceful-degradation rules", () => {
  assert(SKILL);
  const body = SKILL.content;
  // Absent ledger → "no ledger yet", not an error.
  assertStringIncludes(body, "no ledger yet");
  // Malformed line → skipped with a note.
  assertStringIncludes(body, "skipped with a note");
  // Absent field → "unknown".
  assertStringIncludes(body, '"unknown"');
});
