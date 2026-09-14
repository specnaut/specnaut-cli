import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { skillDocName } from "../../src/domain/core_bundle.ts";

/**
 * #431 — Surface Claude Artifacts in generated specs for UX/UI projects.
 *
 * When a spec is authored for a project with a front-end / UX-UI surface, the
 * generated spec must mention Claude Artifacts as a way to visualise the
 * feature, with links to the public docs. When NO front-end surface exists the
 * section is removed entirely — a back-end/CLI-only spec stays artifact-free.
 *
 * These locks live on the bundled template content so the guidance can't drift
 * out of the shipped binary. Two load-bearing surfaces carry it:
 *   - the `plan-template.md` skeleton (the optional, conditional subsection), and
 *   - the `plan` phase doc (the reuse-the-a11y-gate instruction).
 *
 * The gate MUST reuse the accessibility expert's front-end-surface signal
 * list (not a second heuristic) — that reuse is the acceptance criterion.
 */

const DOCS_HELP =
  "https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-to-use-them";
const DOCS_CODE = "https://code.claude.com/docs/en/artifacts";

function planTemplate(): CoreEntry | undefined {
  return CORE_BUNDLE.find(
    (e) =>
      e.category === "spec-root" &&
      e.suffix === "templates/plan-template.md",
  );
}

function planPhase(): CoreEntry | undefined {
  return CORE_BUNDLE.find((e) => e.category === "phase" && skillDocName(e) === "plan");
}

Deno.test("plan-template ships the Claude Artifacts section with public docs links", () => {
  const entry = planTemplate();
  assert(entry, "expected the plan-template.md spec-root entry in CORE_BUNDLE");
  const { content } = entry;
  assertStringIncludes(content, "Visual Prototyping with Claude Artifacts");
  assertStringIncludes(
    content,
    DOCS_HELP,
    "spec-template must link the public 'what are artifacts' doc",
  );
  assertStringIncludes(
    content,
    DOCS_CODE,
    "spec-template must link the Claude Code artifacts doc",
  );
});

Deno.test("plan-template gates the Artifacts section on a front-end surface (a11y signal reuse)", () => {
  const { content } = planTemplate()!;
  // Marked optional + conditional so a non-FE spec drops it entirely.
  assertStringIncludes(content, "optional — front-end / UX-UI features only");
  assertStringIncludes(content, "CONDITIONAL SECTION");
  // Reuses the accessibility gate's mechanism — not a new heuristic.
  assertStringIncludes(
    content,
    "accessibility-expert",
    "the gate must defer to the accessibility expert's FE-surface signal list",
  );
  // The remove-if-none instruction is what keeps back-end/CLI specs artifact-free.
  const lower = content.toLowerCase();
  assert(
    lower.includes("remove this entire section") ||
      lower.includes("remove this section"),
    "plan-template must instruct removing the section when no FE surface exists",
  );
});

Deno.test("plan phase reinforces the FE gate by reusing the accessibility-expert signals", () => {
  const entry = planPhase();
  assert(entry, "expected the plan phase entry in CORE_BUNDLE");
  const { content } = entry;
  assertStringIncludes(content, "Visual Prototyping with Claude Artifacts");
  assertStringIncludes(
    content,
    "accessibility-expert",
    "plan must point authors at the accessibility gate's signal list",
  );
  // A back-end/CLI-only spec must be told NOT to mention artifacts. (The
  // trailing "artifacts" may wrap to the next line in the source prose, so
  // anchor on the contiguous instruction fragment.)
  assertStringIncludes(content, "must not mention");
});
