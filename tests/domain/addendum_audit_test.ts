import { assertEquals } from "@std/assert";
import { auditAddendum, type PhaseAddress } from "../../src/domain/addendum_audit.ts";

/**
 * #622 — the naming rules for `.specnaut/addenda/`, pinned without a
 * filesystem. Every path is relative to the addenda root.
 */

const specnaut = (phase: string): PhaseAddress => ({ skill: "specnaut", phase });
const ship = (phase: string): PhaseAddress => ({ skill: "ship", phase });

Deno.test("a routable phase of either skill is a valid addendum", () => {
  for (
    const rel of [
      "specnaut/plan.md",
      "specnaut/merge.md",
      "specnaut/audit-security.md",
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
  assertEquals(auditAddendum("specnaut/planning.md"), {
    path: "specnaut/planning.md",
    problem: { kind: "unknown-phase", skill: "specnaut" },
    suggestion: specnaut("plan"),
  });
  assertEquals(auditAddendum("specnaut/impl.md")?.suggestion, specnaut("implement"));
});

Deno.test("prefix ties go to the earliest row of the router's phase table", () => {
  assertEquals(auditAddendum("specnaut/audit.md")?.suggestion, specnaut("audit-security"));
});

Deno.test("a stem within two edits of a phase suggests it", () => {
  assertEquals(auditAddendum("specnaut/reveiw.md")?.suggestion, specnaut("review"));
  assertEquals(auditAddendum("ship/relaese.md")?.suggestion, ship("release"));
});

Deno.test("no suggestion when neither prefix nor two edits reaches a phase", () => {
  assertEquals(auditAddendum("specnaut/zzzzzzzz.md"), {
    path: "specnaut/zzzzzzzz.md",
    problem: { kind: "unknown-phase", skill: "specnaut" },
    suggestion: null,
  });
  // Suggestions stay within the skill the file sits under: `plan` is a
  // /specnaut phase, and /ship has nothing near it.
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
  assertEquals(auditAddendum("specnaut/merge-squash.md"), {
    path: "specnaut/merge-squash.md",
    problem: { kind: "contract-doc", parents: [specnaut("merge")] },
    suggestion: null,
  });
  assertEquals(auditAddendum("specnaut/plan-audits.md")?.problem, {
    kind: "contract-doc",
    parents: [specnaut("plan")],
  });
  assertEquals(auditAddendum("specnaut/quality-gates.md")?.problem, {
    kind: "contract-doc",
    parents: [specnaut("implement"), specnaut("merge")],
  });
});

Deno.test("a file outside <skill>/<phase>.md depth is listed with the nearest phase", () => {
  assertEquals(auditAddendum("plan.md"), {
    path: "plan.md",
    problem: { kind: "wrong-depth" },
    suggestion: specnaut("plan"),
  });
  // At the root there is no skill, so both skills are candidates.
  assertEquals(auditAddendum("release.md")?.suggestion, ship("release"));
  assertEquals(auditAddendum("specnaut/extra/review.md"), {
    path: "specnaut/extra/review.md",
    problem: { kind: "wrong-depth" },
    suggestion: specnaut("review"),
  });
});

Deno.test("an unknown skill directory is listed with the nearest phase of any skill", () => {
  assertEquals(auditAddendum("specnut/review.md"), {
    path: "specnut/review.md",
    problem: { kind: "unknown-skill", skill: "specnut" },
    suggestion: specnaut("review"),
  });
  assertEquals(auditAddendum("board/groom.md")?.problem, { kind: "unknown-skill", skill: "board" });
});

Deno.test("a non-.md file is listed, even when its stem names a phase", () => {
  assertEquals(auditAddendum("ship/tag.txt"), {
    path: "ship/tag.txt",
    problem: { kind: "not-markdown" },
    suggestion: ship("tag"),
  });
  assertEquals(auditAddendum("specnaut/plan")?.problem, { kind: "not-markdown" });
});

Deno.test("the phase match is exact — a differently-cased name is not read everywhere", () => {
  // Case-insensitive filesystems would find it; case-sensitive ones would not.
  assertEquals(auditAddendum("specnaut/Plan.md")?.suggestion, specnaut("plan"));
});
