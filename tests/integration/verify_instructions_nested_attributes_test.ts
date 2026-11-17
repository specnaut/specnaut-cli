import { assertEquals } from "@std/assert";
import { advanceBase, commitAll, fixture, git, write } from "./verify_scripts_fixture.ts";
import { base, lines } from "./verify_instructions_fixture.ts";

/**
 * git reads a `.gitattributes` in every folder, for the files below it, and `.lfsconfig` at the
 * repository's top: both decide how git shows and checks out what a session reads. So `specnaut
 * verify-scripts` judges a nested `.gitattributes` at any depth, `.lfsconfig` at the project's
 * root, and both in the folders above a project in a subfolder.
 */

const ATTRIBUTES = "* text=auto eol=lf\n";

Deno.test("an unchanged nested .gitattributes keeps the verdict trusted", async () => {
  const { root } = await fixture({ files: { ...base(), ".specnaut/.gitattributes": ATTRIBUTES } });
  await write(root, { "notes.md": "x\n" });
  await commitAll(root, "an unrelated change");
  assertEquals(await lines(root), ["VERDICT instructions trusted"]);
});

Deno.test("a branch that adds a nested .gitattributes names it", async () => {
  const { root } = await fixture({ files: base() });
  await write(root, { "src/deep/.gitattributes": "*.md -text\n" });
  await commitAll(root, "add");
  assertEquals(await lines(root), [
    "VERDICT instructions untrusted src/deep/.gitattributes not on base",
  ]);
});

Deno.test("a branch that edits .lfsconfig names it", async () => {
  const { root } = await fixture({ files: { ...base(), ".lfsconfig": "[lfs]\n" } });
  await write(root, { ".lfsconfig": "[lfs]\n\turl = https://lfs.example.com\n" });
  await commitAll(root, "edit");
  assertEquals(await lines(root), ["VERDICT instructions untrusted .lfsconfig differs from base"]);
});

Deno.test("the files git reads above a project in a subfolder are named from it", async () => {
  const { root, project } = await fixture({ files: base(), prefix: "app" });
  await advanceBase(root, { ".gitattributes": ATTRIBUTES });
  await git(root, "rebase", "-q", "main");
  assertEquals(await lines(project), ["VERDICT instructions trusted"]);
  await write(root, { ".gitattributes": "* -text\n", ".lfsconfig": "[lfs]\n" });
  await commitAll(root, "edit above the project");
  assertEquals(await lines(project), [
    "VERDICT instructions untrusted ../.gitattributes differs from base",
    "VERDICT instructions untrusted ../.lfsconfig not on base",
  ]);
});
