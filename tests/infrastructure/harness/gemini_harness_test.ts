import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { GeminiHarness } from "../../../src/infrastructure/harness/gemini_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content:
      "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# Body\n\nDo the thing.\n",
    executable: false,
  },
  {
    category: "backlog-cmd",
    name: "backlog",
    suffix: null,
    content: "---\ndescription: Backlog dispatcher\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "skill",
    name: "auto-chain",
    suffix: null,
    content: "---\ndescription: Auto-chain dispatcher\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "agent",
    name: "product-owner",
    suffix: null,
    content:
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\nmaxTurns: 30\n---\n\n# Body\n\nYou are the PO.\n",
    executable: false,
  },
  {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "# const\n",
    executable: false,
  },
  {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    content: "# AGENTS\n",
    executable: false,
  },
];

Deno.test("GeminiHarness.key and displayName", () => {
  const h = new GeminiHarness();
  assertEquals(h.key, "gemini");
  assertEquals(h.displayName, "Gemini CLI");
});

Deno.test("GeminiHarness maps commands to .gemini/commands/specflow-<name>.toml as parseable TOML", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const cmd = mapped[".gemini/commands/specflow-specify.toml"];
  assert(cmd, "command TOML not emitted");
  const parsed = parseToml(cmd.content);
  assertEquals(parsed.description, "Scaffold feature spec");
  assert(typeof parsed.prompt === "string");
  assert(
    (parsed.prompt as string).includes("Do the thing"),
    "command body should land in `prompt` field",
  );
});

Deno.test("GeminiHarness maps backlog-cmd to .gemini/commands/specflow-backlog.toml", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".gemini/commands/specflow-backlog.toml" in mapped);
});

Deno.test("GeminiHarness maps skill to .gemini/skills/specflow-<name>/SKILL.md", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".gemini/skills/specflow-auto-chain/SKILL.md" in mapped);
});

Deno.test("GeminiHarness maps agent to .gemini/agents/<name>.md with stripped frontmatter", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const agent = mapped[".gemini/agents/product-owner.md"];
  assert(agent, "agent markdown not emitted");
  assert(agent.content.startsWith("---\n"), "missing frontmatter");
  assert(agent.content.includes("name: product-owner"));
  assert(agent.content.includes("description: Product Owner role"));
  // Claude-specific fields must be stripped.
  assert(!agent.content.includes("model: opus"), "model should be stripped");
  assert(!agent.content.includes("tools:"), "tools should be stripped");
  assert(!agent.content.includes("maxTurns"), "maxTurns should be stripped");
  // Body preserved.
  assert(agent.content.includes("You are the PO"), "agent body lost");
});

Deno.test("GeminiHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("GeminiHarness emits no Claude/Cursor/Codex artefacts", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/ (Codex root)");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});

Deno.test("GeminiHarness omits TOML description when source frontmatter has none", () => {
  const core: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "no frontmatter at all\n",
    executable: false,
  }];
  const h = new GeminiHarness();
  const mapped = h.mapBundle(core);
  const parsed = parseToml(
    mapped[".gemini/commands/specflow-specify.toml"].content,
  );
  assertEquals("description" in parsed, false);
  assertEquals(parsed.prompt, "no frontmatter at all\n");
});

Deno.test("GeminiHarness synthesises agent description when source has none", () => {
  const core: CoreBundle = [{
    category: "agent",
    name: "lonely-agent",
    suffix: null,
    content: "# A body without frontmatter\n",
    executable: false,
  }];
  const h = new GeminiHarness();
  const mapped = h.mapBundle(core);
  const agent = mapped[".gemini/agents/lonely-agent.md"];
  assert(agent.content.includes("name: lonely-agent"));
  assert(agent.content.includes("description: Specflow lonely-agent agent"));
});
