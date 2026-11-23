import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { SHIPPED_REASON } from "../../src/domain/shipped_skills.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { bundled, commitAll, fixture, write } from "./verify_scripts_fixture.ts";
import { base, lines } from "./verify_instructions_fixture.ts";

/**
 * A case-blind disk gives a session one file for a shipped skill and its name in another letter
 * case, so a case twin or a case-only rename is that shipped skill customised: once the base holds
 * it, it is judged against the copy Specnaut ships, not only against the base (a twin beside the
 * shipped name, which a case-blind disk cannot hold, is in shipped_skills_test.ts). On the branch
 * that adds it, it is the branch's own change, shown as its diff from the base, as any skill the
 * branch edits is. An approval binds the one path it names.
 */

const SKILL = ".claude/skills/task/SKILL.md";
const TWIN = ".claude/skills/Task/SKILL.md";
const MINE = `${bundled(SKILL)}\nAsk before every merge.\n`;
const NAMED = `VERDICT instructions untrusted ${TWIN} ${SHIPPED_REASON}`;
const approving = async (path: string) => `${await sha256Hex(MINE)}  ${path}\n`;

Deno.test("a case-only rename is named, though the base approves those bytes at the old path", async () => {
  const files = { ...base(), [TWIN]: MINE, [APPROVALS_FILE]: await approving(SKILL) };
  const { root } = await fixture({ files });
  assertEquals(await lines(root), [NAMED]);
});

Deno.test("a renamed copy the base holds is trusted once an approval names its own path", async () => {
  const files = { ...base(), [TWIN]: MINE, [APPROVALS_FILE]: await approving(TWIN) };
  const { root } = await fixture({ files });
  assertEquals(await lines(root), ["VERDICT instructions trusted"]);
});

Deno.test("an approval at a renamed path holds nothing once its shipped twin leaves the lock", async () => {
  const files = { ...base(), [TWIN]: MINE, [APPROVALS_FILE]: await approving(TWIN) };
  const { root } = await fixture({ files });
  const lock = ".specnaut/installed.lock";
  await write(root, { [lock]: base()[lock].replace("harness: claude", "harness: codex") });
  await commitAll(root, "switch the harness");
  assertEquals(await lines(root), [NAMED]);
});
