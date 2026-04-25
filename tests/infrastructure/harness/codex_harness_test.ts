import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# body\n",
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
    name: "speckit",
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

Deno.test("CodexHarness maps commands to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-specify/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps backlog-cmd to .agents/skills/specflow-backlog/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps skill to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-speckit/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps agent to .codex/agents/<name>.toml with valid TOML", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
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
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CodexHarness emits no Claude/Cursor artefacts", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/ keys allowed");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/ keys allowed");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md allowed");
});

Deno.test("CodexHarness injects name+description into SKILL.md when absent", () => {
  const core: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core);
  const skill = mapped[".agents/skills/specflow-specify/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specflow-specify"));
});
