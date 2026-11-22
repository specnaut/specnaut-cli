import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { line, MINE, record, SHIP, TASK, untouched } from "./record_approvals_fixture.ts";
import { bundled, commitAll, fixture, git, write } from "./verify_scripts_fixture.ts";
import { base } from "./verify_instructions_fixture.ts";

/**
 * `specnaut record-approvals` judges HEAD again at the commits it is given and, only when the yes's
 * digest still holds, writes the approvals of the customised shipped skills that yes covered to a
 * temporary file: never the work tree, never a commit. `land-feature.sh` commits that file.
 */

Deno.test("a yes that holds writes the approval of the customised skill it covered", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  // The branch's own edit to a shipped skill: shown as its diff from the base, never recorded.
  await write(root, { "README.md": "x\n", [SHIP]: `${bundled(SHIP)}\nBranch edit.\n` });
  await commitAll(root, "docs: readme");
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines.slice(0, -1), [`APPROVED ${await sha256Hex(MINE)} ${TASK}`]);
  assertEquals(r.file, await line(MINE, TASK));
  await untouched(root);
});

Deno.test("a digest that moved writes nothing: exit 1", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  const r = await record(root, "0".repeat(64));
  assertEquals([r.code, r.file], [1, null], r.stderr);
  assertStringIncludes(r.lines.join("\n"), "APPROVAL instructions moved ");
  await untouched(root);
});

Deno.test("a write keeps the approvals still in force, adds the new, drops the dormant", async () => {
  const theirs = `${bundled(SHIP)}\nTheirs.\n`;
  const approvals = [await line(theirs, SHIP), await line(MINE, TASK)].join("");
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: approvals };
  const { root } = await fixture({ files: { ...files, [SHIP]: bundled(SHIP) } });
  const skill = ".claude/skills/specnaut/SKILL.md";
  const custom = `${bundled(skill)}\nMine too.\n`;
  await git(root, "checkout", "-q", "main");
  await write(root, { [skill]: custom });
  await commitAll(root, "customise another skill");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "-B", "feature");
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines[0], `APPROVED ${await sha256Hex(custom)} ${skill}`);
  assertEquals(r.file, await line(custom, skill) + await line(MINE, TASK));
});

Deno.test("nothing to record and nothing dormant leaves the file as it is", async () => {
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: await line(MINE, TASK) };
  const { root } = await fixture({ files });
  const r = await record(root);
  assertEquals([r.code, r.lines, r.file], [0, ["APPROVALS unchanged"], null], r.stderr);
});

Deno.test("a yes covers the approvals file's deletion, never a copy HEAD commits", async () => {
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: await line(MINE, TASK) };
  const deleted = await fixture({ files });
  await Deno.remove(join(deleted.root, APPROVALS_FILE));
  await commitAll(deleted.root, "revoke the approvals");
  const r = await record(deleted.root);
  assertEquals([r.code, r.lines, r.file], [0, ["APPROVALS unchanged"], null], r.stderr);
  // Committed, then deleted from the work tree only: what lands is HEAD's copy.
  const { root } = await fixture({ files });
  await write(root, { [APPROVALS_FILE]: await line(`${MINE}.`, TASK) });
  await commitAll(root, "approve another copy");
  await Deno.remove(join(root, APPROVALS_FILE));
  const forged = await record(root);
  assertEquals([forged.code, forged.file], [1, null], forged.stderr);
  assertStringIncludes(forged.lines.join("\n"), "APPROVAL instructions moved ");
});
