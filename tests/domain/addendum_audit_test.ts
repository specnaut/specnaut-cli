import { assertEquals } from "@std/assert";
import { auditAddendum, type PhaseAddress } from "../../src/domain/addendum_audit.ts";

/**
 * #622 — the naming rules for `.specnaut/addenda/`, pinned without a
 * filesystem. Every path is relative to the addenda root.
 */

const specnaut = (phase: string): PhaseAddress => ({ skill: "specnaut", phase });
const task = (phase: string): PhaseAddress => ({ skill: "task", phase });
const ship = (phase: string): PhaseAddress => ({ skill: "ship", phase });

Deno.test("a routable phase of any skill is a valid addendum", () => {
  for (
    const rel of [
      "specnaut/upgrade.md",
      "specnaut/doc.md",
      "task/plan.md",
      "task/merge.md",
      "task/audit.md",
      "task/groom.md",
      "ship/tag.md",
      "ship/release.md",
    ]
  ) {
    assertEquals(auditAddendum(rel), null, rel);
  }
});

Deno.test("dotfiles are ignored at any depth", () => {
  for (const rel of [".DS_Store", "specnaut/.DS_Store", "specnaut/.plan.md.swp", ".git/HEAD"]) {
    assertEquals(auditAddendum(rel), null, rel);
  }
});

Deno.test("a stem that a phase prefixes, or that prefixes a phase, suggests that phase", () => {
  assertEquals(auditAddendum("task/planning.md"), {
    path: "task/planning.md",
    problem: { kind: "unknown-phase", skill: "task" },
    suggestion: task("plan"),
  });
  assertEquals(auditAddendum("task/impl.md")?.suggestion, task("implement"));
  assertEquals(auditAddendum("specnaut/upgrades.md")?.suggestion, specnaut("upgrade"));
});

Deno.test("prefix ties go to the earliest row of the router's phase table", () => {
  // `re` prefixes `review` (task) and `release` (ship); task's table comes first.
  assertEquals(auditAddendum("other/re.md")?.suggestion, task("review"));
});

Deno.test("an addendum for a retired phase is reported, not silently read (spec 034)", () => {
  assertEquals(auditAddendum("specnaut/audit-security.md")?.problem, {
    kind: "unknown-phase",
    skill: "specnaut",
  });
});

Deno.test("a stem within two edits of a phase suggests it", () => {
  assertEquals(auditAddendum("task/reveiw.md")?.suggestion, task("review"));
  assertEquals(auditAddendum("ship/relaese.md")?.suggestion, ship("release"));
});

Deno.test("no suggestion when neither prefix nor two edits reaches a phase", () => {
  assertEquals(auditAddendum("specnaut/zzzzzzzz.md"), {
    path: "specnaut/zzzzzzzz.md",
    problem: { kind: "unknown-phase", skill: "specnaut" },
    suggestion: null,
  });
  // Suggestions stay within the skill the file sits under: `plan` is a
  // /task phase, and /ship has nothing near it.
  assertEquals(auditAddendum("ship/plan.md")?.suggestion, null);
});

Deno.test("a renamed phase suggests its new address, which may be under the other skill", () => {
  assertEquals(auditAddendum("specnaut/tag-version.md"), {
    path: "specnaut/tag-version.md",
    problem: { kind: "renamed", reason: "release concerns moved from /specnaut to /ship" },
    suggestion: ship("tag"),
  });
  assertEquals(auditAddendum("specnaut/release-version.md")?.suggestion, ship("release"));
});

Deno.test("a contract doc is listed and points at the phase(s) that load it", () => {
  assertEquals(auditAddendum("task/merge-squash.md"), {
    path: "task/merge-squash.md",
    problem: { kind: "contract-doc", parents: [task("merge")] },
    suggestion: null,
  });
  assertEquals(auditAddendum("task/remote-gates.md")?.problem, {
    kind: "contract-doc",
    parents: [task("plan"), task("review")],
  });
  assertEquals(auditAddendum("task/orphan-specs.md")?.problem, {
    kind: "contract-doc",
    parents: [task("groom")],
  });
  assertEquals(auditAddendum("task/quality-gates.md")?.problem, {
    kind: "contract-doc",
    parents: [task("implement"), task("merge")],
  });
});

Deno.test("a file outside <skill>/<phase>.md depth is listed with the nearest phase", () => {
  assertEquals(auditAddendum("plan.md"), {
    path: "plan.md",
    problem: { kind: "wrong-depth" },
    suggestion: task("plan"),
  });
  // At the root there is no skill, so both skills are candidates.
  assertEquals(auditAddendum("release.md")?.suggestion, ship("release"));
  assertEquals(auditAddendum("task/extra/review.md"), {
    path: "task/extra/review.md",
    problem: { kind: "wrong-depth" },
    suggestion: task("review"),
  });
});

Deno.test("an unknown skill directory is listed with the nearest phase of any skill", () => {
  assertEquals(auditAddendum("specnut/review.md"), {
    path: "specnut/review.md",
    problem: { kind: "unknown-skill", skill: "specnut" },
    suggestion: task("review"),
  });
  // `/board` never read an addendum; its groom is now `/task`'s.
  assertEquals(auditAddendum("board/groom.md"), {
    path: "board/groom.md",
    problem: { kind: "unknown-skill", skill: "board" },
    suggestion: task("groom"),
  });
});

Deno.test("a non-.md file is listed, even when its stem names a phase", () => {
  assertEquals(auditAddendum("ship/tag.txt"), {
    path: "ship/tag.txt",
    problem: { kind: "not-markdown" },
    suggestion: ship("tag"),
  });
  assertEquals(auditAddendum("task/plan")?.problem, { kind: "not-markdown" });
});

Deno.test("the phase match is exact — a differently-cased name is not read everywhere", () => {
  // Case-insensitive filesystems would find it; case-sensitive ones would not.
  assertEquals(auditAddendum("task/Plan.md")?.suggestion, task("plan"));
});

Deno.test("an addendum written for the retired tasks verb is pointed at implement (spec 041)", () => {
  for (const path of ["task/tasks.md", "specnaut/tasks.md"]) {
    const finding = auditAddendum(path);
    assertEquals(finding?.problem.kind, "renamed", path);
    assertEquals(finding?.suggestion, task("implement"), path);
  }
});
