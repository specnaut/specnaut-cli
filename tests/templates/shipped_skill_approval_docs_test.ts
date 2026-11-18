import { assertMatch, assertStringIncludes } from "@std/assert";
import { LOCK_SKILL_REASON, SHIPPED_REASON } from "../../src/domain/shipped_skills.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { flat, phase } from "./task_docs.ts";

/**
 * A yes to a customised shipped skill is remembered per content, and the docs say so where the
 * question is asked and where the landing is run: what is remembered, who writes it, how to revoke
 * it, and the lock reason that guards the other key. Read from the bundle, as a project gets them.
 */

const gate = () => flat(phase("script-gate").content);
const merge = () => flat(phase("merge").content);

Deno.test("the instructions verdict says a yes to a shipped-copy line is remembered per bytes", () => {
  const text = gate();
  assertStringIncludes(
    text,
    `A yes to such a line is remembered while the skill keeps those bytes`,
  );
  assertStringIncludes(text, `When a \`${SHIPPED_REASON}\` line is among them, add:`);
  assertStringIncludes(text, `deleting \`${APPROVALS_FILE}\` revokes it`);
  assertStringIncludes(text, "Only the landing writes that file");
  assertStringIncludes(text, "no yes holds it (`APPROVAL instructions moved`)");
  assertStringIncludes(
    text,
    "A forge merge or a direct push lands it unjudged: the file is trusted as the base commits it.",
  );
  assertStringIncludes(
    text,
    `A \`${LOCK_SKILL_REASON}\` reason names \`.specnaut/installed.lock\``,
  );
});

Deno.test("the merge's landing step says it commits the approvals and when it cannot", () => {
  const text = merge();
  assertStringIncludes(
    text,
    `commits the approvals of the customised shipped skills that yes covered (\`${APPROVALS_FILE}\``,
  );
  assertStringIncludes(text, "`APPROVALS NOT RECORDED`");
  assertStringIncludes(text, "the yes no longer held when its approvals were recorded");
});

Deno.test("the merge's step 4 still opens its own list item after the landing step", () => {
  assertMatch(phase("merge").content, /^4\. \*\*Read its exit\*\*/m);
});
