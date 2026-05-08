import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { GeminiHarness } from "../../../src/infrastructure/harness/gemini_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specflow",
    suffix: null,
    content: "---\nname: specflow\ndescription: Specflow router\n---\n\n# Body\n\nRouter.\n",
    executable: false,
  },
  {
    category: "phase",
    name: "specify",
    suffix: "specify.md",
    content: "# Specify phase\n\nDo the thing.\n",
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

Deno.test("GeminiHarness maps router skill to .gemini/skills/specflow/SKILL.md", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".gemini/skills/specflow/SKILL.md" in mapped);
});

Deno.test("GeminiHarness maps phase docs under .gemini/skills/specflow/phases/", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".gemini/skills/specflow/phases/specify.md" in mapped);
});

Deno.test("GeminiHarness maps backlog-cmd to .gemini/commands/specflow-backlog.toml", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".gemini/commands/specflow-backlog.toml" in mapped);
});

Deno.test("GeminiHarness maps skill to .gemini/skills/specflow-<name>/SKILL.md", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".gemini/skills/specflow-auto-chain/SKILL.md" in mapped);
});

Deno.test("GeminiHarness maps agent to .gemini/agents/<name>.md with stripped frontmatter", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
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
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("GeminiHarness emits no Claude/Cursor/Codex artefacts", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/ (Codex root)");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});

Deno.test("GeminiHarness omits TOML description when source frontmatter has none", () => {
  const core: CoreBundle = [{
    category: "backlog-cmd",
    name: "backlog",
    suffix: null,
    content: "no frontmatter at all\n",
    executable: false,
  }];
  const h = new GeminiHarness();
  const mapped = h.mapBundle(core, { backlogBackend: "local" });
  const parsed = parseToml(
    mapped[".gemini/commands/specflow-backlog.toml"].content,
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
  const mapped = h.mapBundle(core, { backlogBackend: "local" });
  const agent = mapped[".gemini/agents/lonely-agent.md"];
  assert(agent.content.includes("name: lonely-agent"));
  assert(agent.content.includes("description: Specflow lonely-agent agent"));
});
