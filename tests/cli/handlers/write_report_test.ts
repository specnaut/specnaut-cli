import { assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { contextLinkLine } from "../../../src/cli/handlers/write_report.ts";

/** The output says which form a context link took, and why (cli#680). */

Deno.test("a symlink is named with its target", () => {
  assertEquals(
    stripAnsiCode(
      contextLinkLine({ dest: ".claude/CLAUDE.md", target: "../AGENTS.md", form: "symlink" }),
    ),
    "✓ .claude/CLAUDE.md → ../AGENTS.md (symlink)",
  );
});

Deno.test("a fallback names the form, the target and the refusal", () => {
  const line = stripAnsiCode(contextLinkLine({
    dest: ".claude/CLAUDE.md",
    target: "../AGENTS.md",
    form: "fallback",
    reason: "PermissionDenied: no privilege",
  }));
  assertStringIncludes(line, "one-line pointer to ../AGENTS.md");
  assertStringIncludes(line, "PermissionDenied: no privilege");
});
