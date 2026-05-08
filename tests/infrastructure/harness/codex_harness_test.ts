import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specflow",
    suffix: null,
    content: "---\nname: specflow\ndescription: Specflow router\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "phase",
    name: "specify",
    suffix: "specify.md",
    content: "# Specify phase\n",
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
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\n---\n\n# Body\n\nYou are the PO.\n",
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

Deno.test("CodexHarness.key and displayName", () => {
  const h = new CodexHarness();
  assertEquals(h.key, "codex");
  assertEquals(h.displayName, "Codex CLI");
});

Deno.test("CodexHarness maps router skill to .agents/skills/specflow/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".agents/skills/specflow/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps phase docs under .agents/skills/specflow/phases/", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".agents/skills/specflow/phases/specify.md" in mapped);
});

Deno.test("CodexHarness maps backlog-cmd to .agents/skills/specflow-backlog/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".agents/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps skill to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".agents/skills/specflow-auto-chain/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps agent to .codex/agents/<name>.toml with valid TOML", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  const agentToml = mapped[".codex/agents/product-owner.toml"];
  assert(agentToml, "agent TOML not emitted");
  const parsed = parseToml(agentToml.content);
  assertEquals(parsed.name, "product-owner");
  assertEquals(parsed.description, "Product Owner role");
  assert(typeof parsed.developer_instructions === "string");
  assert(
    (parsed.developer_instructions as string).includes("You are the PO"),
    "agent body should end up in developer_instructions",
  );
  // Claude-only frontmatter fields must be stripped.
  assertEquals("model" in parsed, false);
  assertEquals("tools" in parsed, false);
});

Deno.test("CodexHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CodexHarness emits no Claude/Cursor artefacts", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local" });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/ keys allowed");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/ keys allowed");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md allowed");
});

Deno.test("CodexHarness injects name+description into SKILL.md when absent", () => {
  const core: CoreBundle = [{
    category: "skill",
    name: "auto-chain",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core, { backlogBackend: "local" });
  const skill = mapped[".agents/skills/specflow-auto-chain/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specflow-auto-chain"));
});
