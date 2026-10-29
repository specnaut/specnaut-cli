import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the per-axis mode of `/task audit` (#380, re-homed by spec 037).
 *
 * The five single-axis skills (`/sec-audit`, `/arch-audit`, `/perf-audit`,
 * `/a11y-audit`, `/dep-audit`) were folded into one verb doc,
 * `task/phases/audit.md`, where each axis is a flag. The rules those five
 * skills carried did not go away with their files; they moved here, and so did
 * this lock:
 *
 * - each axis binds exactly one existing expert agent — now one row of the
 *   axis table, which is the decision's single home (plan.md § 5);
 * - every axis takes the same scope arguments;
 * - an axis flag runs only its own seat, never a team;
 * - the audit is read-only, and a single-axis run writes no file;
 * - no retired address survives in the doc that replaced them.
 *
 * The no-flag (multi-seat) contract is locked in `code_audit_skill_test.ts`.
 */

/** Axis flag → its single bound expert agent. */
const AXES: ReadonlyArray<{ flag: string; agent: string }> = [
  { flag: "--archi", agent: "architect-expert" },
  { flag: "--security", agent: "security-expert" },
  { flag: "--perf", agent: "performance-expert" },
  { flag: "--deps", agent: "dependency-expert" },
  { flag: "--a11y", agent: "accessibility-expert" },
];

function auditDoc(): CoreEntry {
  const e = CORE_BUNDLE.find(
    (x) => x.category === "phase" && x.name === "task" && x.suffix === "audit.md",
  );
  assert(e, "expected the `task` phase audit.md in CORE_BUNDLE");
  return e;
}

/**
 * The axis table's rows, as `[flag, seat, agent, applicable-when]` cells.
 *
 * Parsed rather than substring-matched: "the doc names architect-expert" is
 * satisfied by any sentence anywhere, while the rule is that the `--archi` ROW
 * binds `architect-expert` — swapping two agents between rows must go red.
 */
function axisRows(body: string): string[][] {
  return body.split("\n")
    .filter((l) => /^\|\s*`--[a-z0-9]+`\s*\|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim().replaceAll("`", "")));
}

Deno.test("audit.md ships as the `task` audit phase", () => {
  auditDoc();
});

Deno.test("audit.md's axis table binds each flag to exactly one agent", () => {
  const rows = axisRows(auditDoc().content);
  assertEquals(
    rows.map((r) => r[0]).sort(),
    AXES.map((a) => a.flag).sort(),
    "the axis table must carry one row per axis flag, and no other",
  );
  for (const { flag, agent } of AXES) {
    const row = rows.find((r) => r[0] === flag)!;
    assertEquals(row[2], agent, `${flag} must bind ${agent}`);
  }
});

Deno.test("audit.md's usage line offers every axis flag", () => {
  const usage = auditDoc().content.split("\n").find((l) => l.startsWith("/task audit "));
  assert(usage, "audit.md must carry a `/task audit …` usage line");
  for (const { flag } of AXES) assertStringIncludes(usage, `[${flag}]`);
});

Deno.test("every axis takes the same scope arguments", () => {
  const body = auditDoc().content;
  const usage = body.split("\n").find((l) => l.startsWith("/task audit "))!;
  for (const arg of ["--path <subtree>", "--range <a>..<b>", "--diff", "--last <n>"]) {
    assertStringIncludes(usage, arg, `the usage line must offer ${arg}`);
  }
  // One scope rule for any flag: the scope is resolved once, before seats are
  // selected, so no axis can grow a private scope form.
  assertStringIncludes(body, "**An axis flag and no scope argument** → `--path .`");
  assert(
    body.indexOf("## Step 2 — Resolve the scope") <
      body.indexOf("## Step 3 — Select the seats"),
    "the scope must be resolved before any seat is selected",
  );
  // An unrecognised argument stops; it never widens the audit.
  assertStringIncludes(body, "Never silently fall back to a wider audit");
});

Deno.test("an axis flag runs only its own seat, whatever the signals say", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "**One or more axis flags** → only those seats run.");
  assertStringIncludes(body, "A flag the user named runs its seat whatever the signals say.");
});

Deno.test("the audit is read-only, and a single-axis run writes no file", () => {
  const body = auditDoc().content;
  assertStringIncludes(body, "read-only");
  assertStringIncludes(body, "It mutates **no tracked file**");
  assertStringIncludes(
    body,
    "**One seat** → return its findings inline, with its `REVIEW SUMMARY` verbatim. Write no file.",
  );
  // The one write the verb may make is the multi-seat report, never the code.
  assertStringIncludes(body, "You may persist a multi-seat report");
  assertStringIncludes(body, "the audited code is never touched");
});

Deno.test("audit.md names no address it replaced", () => {
  const body = auditDoc().content;
  for (
    const retired of [
      "/specnaut audit",
      "/code-audit",
      "/sec-audit",
      "/arch-audit",
      "/perf-audit",
      "/a11y-audit",
      "/dep-audit",
      "scripts/code-audit/",
    ]
  ) {
    assert(!body.includes(retired), `audit.md still names the retired ${retired}`);
  }
});
