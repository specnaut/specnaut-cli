import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import {
  predatesPhaseMove,
  SKILL_DOC_RENAMES,
  type SkillDocRename,
} from "../../src/domain/skill_doc_renames.ts";
import { addendumRenames, auditAddendum } from "../../src/domain/addendum_audit.ts";

/**
 * Spec 037 — the rename table is the single home of every moved doc's old and
 * new address (plan § 5), so its invariants are pinned here rather than
 * re-derived per test. #676 and #684 will add rows; a row that points nowhere,
 * or that chains onto another row, fails here instead of in a project whose
 * customised doc stopped being read.
 */

const kindOf = (r: SkillDocRename) => r.kind ?? "phase";
const key = (end: SkillDocRename["from"], kind: string) => `${kind}:${end.owner}/${end.doc}`;
const shipped = (owner: string, doc: string, kind: string) =>
  CORE_BUNDLE.some((e) => e.category === kind && e.name === owner && e.suffix === doc);

Deno.test("every rename target is a bundle entry of the row's kind", () => {
  for (const r of SKILL_DOC_RENAMES) {
    assert(
      shipped(r.to.owner, r.to.doc, kindOf(r)),
      `${key(r.to, kindOf(r))} is not in the bundle — the move would land on nothing`,
    );
  }
});

Deno.test("no rename source still ships — the old address is retired", () => {
  for (const r of SKILL_DOC_RENAMES) {
    assert(
      !shipped(r.from.owner, r.from.doc, kindOf(r)),
      `${key(r.from, kindOf(r))} still ships, so the rename would move a live doc`,
    );
  }
});

Deno.test("no row's source is another row's target — renames never chain", () => {
  const targets = new Set(SKILL_DOC_RENAMES.map((r) => key(r.to, kindOf(r))));
  for (const r of SKILL_DOC_RENAMES) {
    assert(
      !targets.has(key(r.from, kindOf(r))),
      `${key(r.from, kindOf(r))} is both a source and a target: a project two releases ` +
        `behind would stop half-way — collapse the chain into one row`,
    );
  }
});

const TASK_PHASE_DOCS = [
  "plan",
  "plan-audits",
  "tasks",
  "implement",
  "epic-commits",
  "epic-fixups",
  "epic-loop",
  "quality-gates",
  "review",
  "merge",
  "merge-squash",
  "merge-close",
  "auto-chain",
  "constitution",
];

Deno.test("addendumRenames() yields the 14 phase moves to /task, the /ship moves, nothing from /board", () => {
  const moves = addendumRenames().map((m) =>
    `${m.from.skill}/${m.from.phase}→${m.to.skill}/${m.to.phase}`
  );
  assertEquals(
    moves.filter((m) => m.includes("→task/")).sort(),
    TASK_PHASE_DOCS.map((d) => `specnaut/${d}→task/${d}`).sort(),
  );
  assert(
    moves.includes("specnaut/tag-version→ship/tag"),
    "the /ship rename addendum is left behind",
  );
  assert(moves.includes("specnaut/release-version→ship/release"));
  assert(
    !moves.some((m) => m.startsWith("board/")),
    "an addendum under board/ was never read — moving it would switch it on unasked",
  );
  assertEquals(moves.length, TASK_PHASE_DOCS.length + 2);
});

Deno.test("an addendum left at a moved phase's old address is named, with the new one", () => {
  assertEquals(auditAddendum("specnaut/plan.md"), {
    path: "specnaut/plan.md",
    problem: { kind: "renamed", reason: "one unit of work moved from /specnaut to /task" },
    suggestion: { skill: "task", phase: "plan" },
  });
});

Deno.test("a moved contract doc is still a contract doc, pointing at its new parent", () => {
  assertEquals(auditAddendum("specnaut/merge-squash.md"), {
    path: "specnaut/merge-squash.md",
    problem: { kind: "contract-doc", parents: [{ skill: "task", phase: "merge" }] },
    suggestion: null,
  });
});

Deno.test("a router baseline is judged against the release that moved the phases", () => {
  assertEquals(predatesPhaseMove("7.1.0"), true);
  assertEquals(predatesPhaseMove("7.2.0-rc.1"), true);
  assertEquals(predatesPhaseMove("7.2.0"), false);
  assertEquals(predatesPhaseMove("8.0.0"), false);
  // Unreadable fails toward the warning, never toward silence.
  assertEquals(predatesPhaseMove("not-a-version"), true);
});
