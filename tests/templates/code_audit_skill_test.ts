import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the `/code-audit` orchestration contract into the bundled SKILL.md so it
 * can't drift silently. The skill DISPATCHES the existing auditor agents — it
 * defines none of its own — and the load-bearing instructions (single-message
 * parallel dispatch, seat→signal selection, dominance verdict, read-only) must
 * survive every edit. Also asserts the skill + its scope script ship in the
 * CORE_BUNDLE (the distribution half).
 *
 * Contracts: contracts/unified-report.md + contracts/scope-signals.md.
 */

function bundleEntry(
  category: string,
  predicate: (e: CoreEntry) => boolean,
): CoreEntry | undefined {
  return CORE_BUNDLE.find((e) => e.category === category && predicate(e));
}

const SKILL = bundleEntry("skill", (e) => e.name === "code-audit");

Deno.test("code-audit SKILL.md is bundled in CORE_BUNDLE", () => {
  assert(SKILL, "expected a `skill` entry named code-audit in CORE_BUNDLE");
});

Deno.test("collect-audit-scope.sh ships in CORE_BUNDLE as an executable asset", () => {
  const script = bundleEntry(
    "spec-root",
    (e) => e.suffix === "scripts/code-audit/collect-audit-scope.sh",
  );
  assert(
    script,
    "expected the scope script in CORE_BUNDLE at scripts/code-audit/collect-audit-scope.sh",
  );
  assert(script.executable, "the scope script must be marked executable");
  assertStringIncludes(script.content, "CODE-AUDIT SCOPE");
  assertStringIncludes(script.content, "CATEGORY SIGNALS");
});

Deno.test("code-audit SKILL body mandates single-message parallel dispatch (SC-003)", () => {
  assert(SKILL);
  const body = SKILL.content;
  assertStringIncludes(body, "SINGLE message");
  assertStringIncludes(body, "one `Agent` call per seat");
  assertStringIncludes(body, "never one after another");
});

Deno.test("code-audit SKILL body encodes the seat→signal selection rules", () => {
  assert(SKILL);
  const body = SKILL.content;
  // Always-on seats.
  assertStringIncludes(body, "architecture-auditor");
  assertStringIncludes(body, "security-auditor");
  assertStringIncludes(body, "performance-auditor");
  // Signal-gated seats.
  assertStringIncludes(body, "a11y-auditor");
  assertStringIncludes(body, "dependency-auditor");
  assertStringIncludes(body, "FRONTEND_COUNT > 0");
  assertStringIncludes(body, "DEP_COUNT > 0");
});

Deno.test("code-audit SKILL body locks the file:line dedupe synthesis step", () => {
  assert(SKILL);
  const body = SKILL.content;
  // Removing the synthesis/dedupe instruction must fail a test: the unified
  // report is the whole point (one deduplicated report, not N separate ones).
  assertStringIncludes(body, "Synthesize ONE report");
  assertStringIncludes(body, "dedupe by `file:line`");
  assertStringIncludes(body, "severity-rank");
});

Deno.test("code-audit SKILL body states the dominance verdict rule", () => {
  assert(SKILL);
  const body = SKILL.content;
  assertStringIncludes(body, "REVIEW SUMMARY");
  assertStringIncludes(body, "`fail` if **any**");
  assertStringIncludes(body, "needs_followup");
  assert(
    /per-seat\s+sums/.test(body),
    "expected the counts to be described as per-seat sums",
  );
});

Deno.test("code-audit SKILL body states it is read-only and stops on empty scope", () => {
  assert(SKILL);
  const body = SKILL.content;
  assertStringIncludes(body, "read-only");
  assertStringIncludes(body, "TOTAL_FILES: 0");
  assertStringIncludes(body, "Nothing to audit");
});

Deno.test("code-audit SKILL body notes it is complementary to /specflow audit <axis>", () => {
  assert(SKILL);
  assertStringIncludes(SKILL.content, "/specflow audit <axis>");
  assertStringIncludes(SKILL.content, "complementary");
});
