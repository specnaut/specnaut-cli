import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ensureSkillFrontmatter,
  skillFolderName,
} from "../../../src/infrastructure/harness/skill_folder.ts";
import type { CoreEntry } from "../../../src/domain/core_bundle.ts";

function entry(category: CoreEntry["category"], name: string): CoreEntry {
  return { category, name, suffix: null, content: "", executable: false };
}

Deno.test("skillFolderName: backlog-cmd → specnaut-<name>", () => {
  assertEquals(skillFolderName(entry("backlog-cmd", "backlog")), "specnaut-backlog");
});

Deno.test("skillFolderName: skill → specnaut-<name>", () => {
  assertEquals(skillFolderName(entry("skill", "specnaut-auto")), "specnaut-auto");
});

Deno.test("skillFolderName: skill named 'specnaut' is not double-prefixed", () => {
  assertEquals(skillFolderName(entry("skill", "specnaut")), "specnaut");
});

Deno.test("skillFolderName: skill already starting with 'specnaut-' is kept as-is", () => {
  assertEquals(skillFolderName(entry("skill", "specnaut-review")), "specnaut-review");
});

Deno.test("skillFolderName: agent → specnaut-agent-<name>", () => {
  assertEquals(skillFolderName(entry("agent", "product-owner")), "specnaut-agent-product-owner");
});

Deno.test("skillFolderName: throws for spec-root and project-root", () => {
  assertThrows(
    () =>
      skillFolderName({
        category: "spec-root",
        name: "specify",
        suffix: "x",
        content: "",
        executable: false,
      }),
    Error,
    "not applicable",
  );
  assertThrows(
    () =>
      skillFolderName({
        category: "project-root",
        name: "root",
        suffix: "x",
        content: "",
        executable: false,
      }),
    Error,
    "not applicable",
  );
});

Deno.test("ensureSkillFrontmatter: synthesizes frontmatter when absent", () => {
  const out = ensureSkillFrontmatter("# body\n", "my-skill");
  assert(out.startsWith("---\n"));
  assert(out.includes("name: my-skill"));
  assert(out.includes("description: Specnaut skill: my-skill"));
  assert(out.endsWith("# body\n"));
});

Deno.test("ensureSkillFrontmatter: preserves existing name and description", () => {
  const input = "---\nname: user-choice\ndescription: User-written\n---\n\n# body\n";
  const out = ensureSkillFrontmatter(input, "default-name");
  assert(out.includes("name: user-choice"));
  assert(out.includes("description: User-written"));
  assert(!out.includes("name: default-name"));
});
