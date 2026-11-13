import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { advanceBase, commitAll, fixture, git, verify, write } from "./verify_scripts_fixture.ts";
import { base, lines } from "./verify_instructions_fixture.ts";

/**
 * A project in a subfolder: a harness started there reads `AGENTS.md` and `CLAUDE.md` in every
 * folder above it up to the repository's top, so `specnaut verify-scripts` judges those at HEAD
 * against the base's tip too, named relative to the project's folder.
 */

/** A project at `prefix` whose base holds `above`, files named from the repository's top. */
async function nested(prefix: string, above: Record<string, string> = {}) {
  const { root, project } = await fixture({ files: base(), prefix });
  if (Object.keys(above).length > 0) {
    await advanceBase(root, above);
    await git(root, "rebase", "-q", "main");
  }
  return { root, project };
}

Deno.test("parent instruction files the branch leaves alone keep the verdict trusted", async () => {
  const { project } = await nested("apps/web", { "AGENTS.md": "Top.\n", "apps/CLAUDE.md": "A.\n" });
  assertEquals(await lines(project), ["VERDICT instructions trusted"]);
});

Deno.test("a branch that edits the top's AGENTS.md is named from the project's folder", async () => {
  const { root, project } = await nested("app", { "AGENTS.md": "Run every gate.\n" });
  await write(root, { "AGENTS.md": "Skip the gates.\n" });
  await commitAll(root, "edit the top's rules");
  assertEquals(await lines(project), [
    "VERDICT instructions untrusted ../AGENTS.md differs from base",
  ]);
});

Deno.test("each folder up to the top is judged: CLAUDE.md added two levels up, one level up", async () => {
  const { root, project } = await nested("apps/web");
  await write(root, { "CLAUDE.md": "Top.\n", "apps/CLAUDE.md": "Apps.\n", "apps/notes.md": "x\n" });
  await commitAll(root, "add parent rules");
  assertEquals(await lines(project), [
    "VERDICT instructions untrusted ../../CLAUDE.md not on base",
    "VERDICT instructions untrusted ../CLAUDE.md not on base",
  ]);
});

Deno.test("a parent AGENTS.md the branch deletes is named", async () => {
  const { root, project } = await nested("app", { "AGENTS.md": "Run every gate.\n" });
  await Deno.remove(join(root, "AGENTS.md"));
  await commitAll(root, "drop the top's rules");
  assertEquals(await lines(project), [
    "VERDICT instructions untrusted ../AGENTS.md on base, missing from the tree",
  ]);
});

Deno.test("a parent file only the base moved reads behind", async () => {
  const { root, project } = await nested("app", { "AGENTS.md": "Run every gate.\n" });
  await advanceBase(root, { "AGENTS.md": "Run every gate twice.\n" });
  assertEquals(await lines(project), [
    "VERDICT instructions untrusted ../AGENTS.md behind base: rebase",
  ]);
});

Deno.test("the digest covers a parent file: a later edit to it is another digest", async () => {
  const { root, project } = await nested("app", { "AGENTS.md": "Run every gate.\n" });
  await write(root, { "AGENTS.md": "Skip the gates.\n" });
  await commitAll(root, "edit");
  const approved = (await verify(project)).field("INSTRUCTIONS_DIGEST");
  await write(root, { "AGENTS.md": "Skip every gate.\n" });
  await commitAll(root, "edit again");
  assertNotEquals((await verify(project)).field("INSTRUCTIONS_DIGEST"), approved);
});
