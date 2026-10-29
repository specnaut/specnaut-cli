import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the multi-seat orchestration contract of `/task audit` — what
 * `/code-audit` was before spec 037 folded it into `task/phases/audit.md`.
 *
 * The verb DISPATCHES the existing expert agents and defines none of its own,
 * and its load-bearing instructions must survive every edit: single-message
 * parallel dispatch, seat→signal gating, the `file:line` dedupe, the dominance
 * verdict, the stop on an empty scope, read-only. Also asserts the scope
 * script ships in CORE_BUNDLE, executable, at the path the doc runs it from.
 *
 * The per-axis (flag) contract is locked in `per_axis_audit_skills_test.ts`.
 */

const SCRIPT_SUFFIX = "scripts/audit/collect-audit-scope.sh";

function auditDoc(): CoreEntry {
  const e = CORE_BUNDLE.find(
    (x) => x.category === "phase" && x.name === "task" && x.suffix === "audit.md",
  );
  assert(e, "expected the `task` phase audit.md in CORE_BUNDLE");
  return e;
}

/** The axis table's rows keyed by agent → the row's applicability cell. */
function applicability(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of body.split("\n")) {
    if (!/^\|\s*`--[a-z0-9]+`\s*\|/.test(l)) continue;
    const cells = l.split("|").slice(1, -1).map((c) => c.trim());
    out.set(cells[2].replaceAll("`", ""), cells[3]);
  }
  return out;
}

Deno.test("collect-audit-scope.sh ships in CORE_BUNDLE as an executable asset", () => {
  const script = CORE_BUNDLE.find(
    (e) => e.category === "spec-root" && e.suffix === SCRIPT_SUFFIX,
  );
  assert(script, `expected the scope script in CORE_BUNDLE at ${SCRIPT_SUFFIX}`);
  assert(script.executable, "the scope script must be marked executable");
  assertStringIncludes(script.content, "CODE-AUDIT SCOPE");
  assertStringIncludes(script.content, "CATEGORY SIGNALS");
});

Deno.test("audit.md runs the scope script from the path it installs to", () => {
  // `spec-root` entries install under `.specnaut/`. A doc naming any other
  // path runs a script that is not there — the old `scripts/code-audit/` one.
  assertStringIncludes(auditDoc().content, `.specnaut/${SCRIPT_SUFFIX}`);
});

Deno.test("with no axis flag, every applicable seat runs and one report is synthesized", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "**No axis flag** → every applicable seat runs, in parallel");
  assert(/synthesized\s+into one report/.test(body), "the no-flag run must synthesize one report");
});

Deno.test("audit.md mandates single-message parallel dispatch (SC-003)", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "IN PARALLEL (one message)");
  assertStringIncludes(body, "One `Agent` call per seat, all in the same message");
  assertStringIncludes(body, "never one after another");
});

Deno.test("audit.md gates each seat on the right signal", () => {
  const rows = applicability(auditDoc().content);
  for (const always of ["architect-expert", "security-expert", "performance-expert"]) {
    assertStringIncludes(rows.get(always) ?? "", "(always)", `${always} must always run`);
  }
  assertEquals(rows.get("accessibility-expert"), "`FRONTEND_COUNT > 0`");
  assertEquals(rows.get("dependency-expert"), "`DEP_COUNT > 0`");
  const body = auditDoc().content;
  assertStringIncludes(body, "Only `FRONTEND_COUNT` and `DEP_COUNT` gate");
  assertStringIncludes(body, "These are the **existing** expert agents");
});

Deno.test("audit.md locks the file:line dedupe synthesis step", () => {
  // The unified report is the whole point of the no-flag run: one deduplicated
  // report, not N separate ones.
  const body = auditDoc().content;
  assertStringIncludes(body, "dedupe by `file:line`");
  assertStringIncludes(body, "severity-rank");
  assertStringIncludes(body, "**never silently dropped**");
});

Deno.test("audit.md states the dominance verdict rule", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "REVIEW SUMMARY");
  assertStringIncludes(body, "`fail` if **any**");
  assertStringIncludes(body, "`needs_followup` if any seat reported `needs_followup`");
  assert(/per-seat\s+sums/.test(body), "expected the counts to be described as per-seat sums");
});

Deno.test("audit.md is read-only and stops on an empty scope", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "read-only");
  assertStringIncludes(body, "`TOTAL_FILES: 0`, dispatch nothing");
  assertStringIncludes(body, "Nothing to audit in this scope.");
});
