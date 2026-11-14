import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { commitAll, fixture, git, write } from "./verify_scripts_fixture.ts";
import { base, lines } from "./verify_instructions_fixture.ts";

/**
 * The import walk starts from every judged instruction file, a linked one through its end: the
 * layout Specnaut scaffolds (`.claude/CLAUDE.md` linked to `../AGENTS.md`, or a copy importing it
 * where links are off) imports whatever AGENTS.md imports.
 */

const RULES = { "AGENTS.md": "# Rules\n\nAlso read @notes.md\n", "notes.md": "Run every gate.\n" };

async function editNotes(root: string) {
  await write(root, { "notes.md": "Skip the gates.\n" });
  await commitAll(root, "edit notes");
}

Deno.test("scaffold layout: .claude/CLAUDE.md links to AGENTS.md, which imports notes.md", {
  ignore: Deno.build.os === "windows", // a committed link needs links on
}, async () => {
  const { root } = await fixture({ files: { ...base(), ...RULES } });
  await Deno.mkdir(join(root, ".claude"), { recursive: true });
  await Deno.symlink("../AGENTS.md", join(root, ".claude/CLAUDE.md"));
  await commitAll(root, "link the rules");
  await git(root, "push", "-q", "origin", "HEAD:main");
  assertEquals(await lines(root), ["VERDICT instructions trusted"]);
  await editNotes(root);
  assertEquals(await lines(root), ["VERDICT instructions untrusted notes.md differs from base"]);
});

Deno.test("no-links fallback: .claude/CLAUDE.md imports ../AGENTS.md as text", async () => {
  const files = { ...base(), ...RULES, ".claude/CLAUDE.md": "@../AGENTS.md\n" };
  const { root } = await fixture({ files });
  await editNotes(root);
  assertEquals(await lines(root), ["VERDICT instructions untrusted notes.md differs from base"]);
});

Deno.test("a CLAUDE.md linked to an addendum imports from the addendum's folder", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const addendum = {
    ".specnaut/addenda/task/rules.md": "@notes.md\n",
    ".specnaut/addenda/task/notes.md": "a\n",
  };
  const { root } = await fixture({ files: { ...base(), ...addendum } });
  await Deno.symlink(".specnaut/addenda/task/rules.md", join(root, "CLAUDE.md"));
  await commitAll(root, "link");
  await git(root, "push", "-q", "origin", "HEAD:main");
  assertEquals(await lines(root), ["VERDICT instructions trusted"]);
  await write(root, { "outside.md": "x\n" }); // keeps the commit below from being empty
  await write(root, { ".specnaut/addenda/task/notes.md": "b\n" });
  await commitAll(root, "edit");
  assertEquals(await lines(root), [
    "VERDICT instructions untrusted .specnaut/addenda/task/notes.md differs from base",
  ]);
});
