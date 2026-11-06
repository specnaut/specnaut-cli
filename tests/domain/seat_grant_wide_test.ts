import { assertEquals } from "@std/assert";
import { wideGrant } from "../../src/domain/seat_grant_wide.ts";

/** Which shell and write tools an agent file grants, in each harness's own shape. */

const md = (fm: string) => `---\nname: product-owner\n${fm}---\n\nBody naming Bash and Write.\n`;

Deno.test("seat grant: a tools line names what it grants; Read, Grep, Glob is narrow", () => {
  assertEquals(wideGrant("claude", md("tools: Read, Grep, Glob\n")), []);
  assertEquals(wideGrant("claude", md("tools: Read, Write, Edit, Grep, Glob, Bash\n")), [
    "Bash",
    "Write",
    "Edit",
  ]);
  assertEquals(wideGrant("antigravity", md("tools: Read, MultiEdit, Bash(git log *)\n")), [
    "Bash",
    "Edit",
  ]);
});

Deno.test("seat grant: no tools line is the harness default, every tool", () => {
  assertEquals(wideGrant("claude", md("model: opus\n")), ["Bash", "Write", "Edit"]);
  assertEquals(wideGrant("claude", "No frontmatter at all.\n"), ["Bash", "Write", "Edit"]);
});

Deno.test("seat grant: OpenCode grants what its permission block does not deny", () => {
  const narrow = "permission:\n  read: allow\n  write: deny\n  edit: deny\n  bash: deny\n";
  assertEquals(wideGrant("opencode", md(narrow)), []);
  assertEquals(wideGrant("opencode", md('permission:\n  "*": deny\n  read: allow\n')), []);
  assertEquals(wideGrant("opencode", md('permission:\n  "*": deny\n  edit: allow\n')), ["Edit"]);
  const wide = 'permission:\n  read: allow\n  write: deny\n  edit: allow\n  bash:\n    "*": ask\n';
  assertEquals(wideGrant("opencode", md(wide)), ["Bash", "Edit"]);
});

Deno.test("seat grant: a Codex file is read for its shell switch only", () => {
  assertEquals(wideGrant("codex", 'name = "po"\n\n[features]\nshell_tool = false\n'), []);
  assertEquals(wideGrant("codex", 'name = "po"\n# shell_tool = false\n'), ["Bash"]);
});
