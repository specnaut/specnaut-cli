import { assertEquals } from "@std/assert";
import { commandPaths, isCommandSource } from "../../src/domain/command_targets.ts";

/**
 * A skill's, an agent's or a slash command's own commands: the hooks its frontmatter declares and
 * the `` !`…` `` spans Claude Code runs before the command's text is sent. Read as text, never run.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const read = (path: string, text: string) => commandPaths(path, enc(text), none);
const has = (paths: readonly string[], ...wanted: string[]) =>
  assertEquals(wanted.filter((w) => !paths.includes(w)), [], paths.join(" "));

const HOOKED = [
  "---",
  "name: lint",
  "description: Checks docs/guide.md before it lands",
  "hooks:",
  "  PostToolUse:",
  "    - matcher: Edit",
  "      hooks:",
  "        - type: command",
  '          command: "$CLAUDE_PROJECT_DIR/scripts/lint.sh"',
  "---",
  "Read src/app.ts first.",
  "",
].join("\n");

Deno.test("a skill's, an agent's and a command's files are command sources; a skill's other files are not", () => {
  const sources = [".claude/skills/x/SKILL.md", ".claude/agents/a.md", ".claude/commands/c/d.md"];
  assertEquals(sources.map(isCommandSource), [true, true, true]);
  assertEquals(isCommandSource(".Claude/Skills/x/skill.md"), true);
  assertEquals([".claude/skills/x/notes.md", ".claude/rules/r.md"].map(isCommandSource), [
    false,
    false,
  ]);
});

Deno.test("a frontmatter hook names the file it runs, in a skill and in an agent", () => {
  for (const path of [".claude/skills/lint/SKILL.md", ".claude/agents/linter.md"]) {
    const found = read(path, HOOKED);
    has(found.paths, "scripts/lint.sh");
    assertEquals(found.whole, true);
  }
});

Deno.test("the prose and the frontmatter's other keys name no target", () => {
  const paths = read(".claude/skills/lint/SKILL.md", HOOKED).paths;
  assertEquals(paths.filter((p) => p === "docs/guide.md" || p === "src/app.ts"), []);
});

Deno.test("a `!` span of a command, or of a skill, names the file it runs", () => {
  const text = "Context: !`bash tools/context.sh --short`\n\nThen read notes/plan.md.\n";
  for (const path of [".claude/commands/review.md", ".claude/skills/r/SKILL.md"]) {
    const paths = read(path, text).paths;
    has(paths, "tools/context.sh");
    assertEquals(paths.includes("notes/plan.md"), false);
  }
});

Deno.test("a ```! block of a command, or of a skill, names the files it runs, closed or not", () => {
  const block = [
    "````!",
    "bash tools/env.sh",
    "node scripts/seed.js",
    "````",
    "Then tools/prose.sh.",
  ];
  const open = ["```!", "bash tools/last.sh"];
  for (const path of [".claude/commands/setup.md", ".claude/skills/s/SKILL.md"]) {
    const paths = read(path, [...block, ...open].join("\n")).paths;
    has(paths, "tools/env.sh", "scripts/seed.js", "tools/last.sh");
    assertEquals(paths.includes("tools/prose.sh"), false);
  }
  const fenced = ["```bash", "bash tools/shown.sh", "```", ""].join("\n");
  assertEquals(read(".claude/commands/c.md", fenced).paths.includes("tools/shown.sh"), false);
});

Deno.test("an agent's `!` spans and blocks run nothing: an agent's file, or a note beside it", () => {
  const text = "Context: !`bash tools/context.sh`\n\n```!\nbash tools/env.sh\n```\n";
  for (const path of [".claude/agents/a.md", ".claude/agents/a/memory/note.md"]) {
    const paths = read(path, text).paths;
    assertEquals([paths.includes("tools/context.sh"), paths.includes("tools/env.sh")], [
      false,
      false,
    ]);
  }
});

Deno.test("a skill's or a command's allowed-tools grants are read as permission rules are", () => {
  const listed = "---\nallowed-tools:\n  - Read\n  - Bash(./scripts/deploy.sh *)\n---\n";
  has(read(".claude/skills/d/SKILL.md", listed).paths, "scripts/deploy.sh");
  const spaced = "---\nallowed-tools: Read Bash(tools/release.sh *)\n---\nRelease.\n";
  has(read(".claude/commands/release.md", spaced).paths, "tools/release.sh");
});

Deno.test("a frontmatter that does not parse is read from its lines, and not whole", () => {
  const broken = "---\nhooks: {Stop: [{hooks: [{command: tools/stop.sh}]\n---\nbody\n";
  const found = read(".claude/agents/a.md", broken);
  has(found.paths, "tools/stop.sh");
  assertEquals(found.whole, false);
});

Deno.test("a hook spelled as YAML escapes is read through the parse", () => {
  const text = '---\nhooks:\n  Stop:\n    - hooks:\n        - command: "tools/\\x73top.sh"\n---\n';
  has(read(".claude/agents/a.md", text).paths, "tools/stop.sh");
});

Deno.test("aliases repeated a thousand million times are each read once, and the reading is whole", () => {
  // Walked once per use, the aliases would meet the walk's cap (a quarter of a million values,
  // reached in a moment) and make the reading not whole: a regression fails, and never hangs.
  const levels = Array.from({ length: 30 }, (_, i) => `  l${i + 1}: &l${i + 1} [*l${i}, *l${i}]`);
  const text = ["---", "hooks:", "  l0: &l0 [tools/deep.sh]", ...levels, "---", ""].join("\n");
  const found = read(".claude/agents/a.md", text);
  has(found.paths, "tools/deep.sh");
  assertEquals(found.whole, true);
});

Deno.test("a frontmatter past the parse limit is read from its lines, and not whole", () => {
  const big = HOOKED.replace("name: lint", `name: lint\nnote: ${"x ".repeat(140_000)}`);
  const found = read(".claude/skills/lint/SKILL.md", big);
  has(found.paths, "scripts/lint.sh");
  assertEquals(found.whole, false);
});
