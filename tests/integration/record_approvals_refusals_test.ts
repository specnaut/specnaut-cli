import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { APPROVALS_FILE } from "../../src/domain/skill_approvals.ts";
import { line, MINE, record, recordWith, TASK } from "./record_approvals_fixture.ts";
import { commitAll, fixture, git } from "./verify_scripts_fixture.ts";
import { base } from "./verify_instructions_fixture.ts";

/**
 * What `specnaut record-approvals` refuses: each skill the yes covered that no approval may hold is
 * a `NOT APPROVED` line with its reason, HEAD's approvals file it cannot read is written whole with
 * a warning, and a commit it does not hold is exit 3 with nothing written.
 */

const LOCK = ".specnaut/installed.lock";

/** Puts `change` on origin's main and brings the feature branch up to it, as a landing would. */
async function onBase(root: string, change: () => Promise<void>) {
  await git(root, "checkout", "-q", "main");
  await change();
  await commitAll(root, "base moves");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
  await git(root, "merge", "-q", "--ff-only", "main");
}

Deno.test("a shipped skill HEAD holds as a link is not approved", async () => {
  // A link to a file the check reads: one out of them is named for that alone.
  const { root } = await fixture({ files: { ...base(), ".claude/skills/task/mine.md": MINE } });
  await onBase(root, () => Deno.symlink("mine.md", join(root, TASK), { type: "file" }));
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines, [
    `NOT APPROVED ${TASK} is not a regular file at HEAD`,
    "APPROVALS unchanged",
  ]);
});

Deno.test("a shipped skill HEAD also holds in another letter case is not approved", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  const twin = TASK.replace("SKILL.md", "skill.md");
  const blob = (await git(root, "hash-object", "-w", TASK)).trim();
  await git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},${twin}`);
  await git(root, "commit", "-q", "-m", "a twin in another letter case");
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines[0], `NOT APPROVED ${TASK} is at HEAD in another letter case too`);
  assertEquals(r.file, null);
});

Deno.test("a shipped skill whose path no approval may name is not approved", {
  // A backslash in a file name: Windows reads it as a folder.
  ignore: Deno.build.os === "windows",
}, async () => {
  const odd = ".claude/skills/task/a\\b.md";
  const entry = `  '${odd}':\n    sha256: ${await sha256Hex("old")}\n` +
    "    installed_at: '2020-01-01T00:00:00Z'\n    templates_version: 0.0.1\n";
  const lock = base()[LOCK].replace("entries: {}\n", `entries:\n${entry}`);
  const { root } = await fixture({ files: { ...base(), [LOCK]: lock, [odd]: "mine\n" } });
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.lines[0].startsWith("NOT APPROVED .claude/skills/task/a"), true, r.lines[0]);
  assertEquals(r.lines[0].endsWith(" is not a path an approval may name"), true, r.lines[0]);
});

Deno.test("HEAD's approvals file out of form is written whole, with a warning", async () => {
  const files = { ...base(), [TASK]: MINE, [APPROVALS_FILE]: "not an approval\n" };
  const { root } = await fixture({ files });
  const r = await record(root);
  assertEquals(r.code, 0, r.stderr);
  const warning =
    `warning: specnaut record-approvals: HEAD's ${APPROVALS_FILE} is not read, so it ` +
    "is written whole: holds a line that is not `<sha256>  <path>`";
  assertStringIncludes(r.stderr, warning);
  assertEquals(r.file, await line(MINE, TASK));
});

Deno.test("a --head or a --base-tip that names no commit here is exit 3, nothing written", async () => {
  const { root } = await fixture({ files: { ...base(), [TASK]: MINE } });
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  const tree = (await git(root, "rev-parse", "HEAD^{tree}")).trim();
  const yes = ["--instructions-digest", "0".repeat(64)];
  const noHead = await recordWith(root, [...yes, "--head", "f".repeat(40), "--base-tip", head]);
  assertEquals([noHead.code, noHead.file], [3, null], noHead.stderr);
  assertStringIncludes(noHead.stderr, "--head names no commit here");
  const noTip = await recordWith(root, [...yes, "--head", head, "--base-tip", tree]);
  assertEquals([noTip.code, noTip.file], [3, null], noTip.stderr);
  assertStringIncludes(noTip.stderr, "--base-tip names no commit here");
});
