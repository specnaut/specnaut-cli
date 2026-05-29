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
    name: "specflow-auto",
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
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".agents/skills/specflow/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps phase docs under .agents/skills/specflow/phases/", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".agents/skills/specflow/phases/specify.md" in mapped);
});

Deno.test("CodexHarness maps backlog-cmd to .agents/skills/specflow-backlog/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".agents/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps skill to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".agents/skills/specflow-auto/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps agent to .codex/agents/<name>.toml with valid TOML", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
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
  // The Claude `model` tier is translated to Codex `model_reasoning_effort`,
  // never copied verbatim; `tools` is dropped entirely.
  assertEquals("model" in parsed, false);
  assertEquals(parsed.model_reasoning_effort, "high"); // opus → high
  assertEquals("tools" in parsed, false);
});

Deno.test("CodexHarness maps agent model tiers to model_reasoning_effort", () => {
  const agent = (name: string, model: string | null): CoreBundle[number] => ({
    category: "agent",
    name,
    suffix: null,
    content: `---\nname: ${name}\ndescription: ${name} role\n${
      model === null ? "" : `model: ${model}\n`
    }tools: Read\n---\n\n# Body\n`,
    executable: false,
  });
  const core: CoreBundle = [
    agent("heavy", "opus"), // → high
    agent("mid", "sonnet"), // → medium
    agent("light", "haiku"), // → low
    agent("none", null), // → omitted (inherit session default)
    agent("inherit", "inherit"), // → omitted
    agent("weird", "gpt-9-ultra"), // → omitted (unrecognised, no guess)
  ];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core, { backlogBackend: "local", versionScheme: "semver" });

  const effortOf = (name: string) => {
    const file = mapped[`.codex/agents/${name}.toml`];
    assert(file, `${name} TOML not emitted`);
    return parseToml(file.content).model_reasoning_effort;
  };

  assertEquals(effortOf("heavy"), "high");
  assertEquals(effortOf("mid"), "medium");
  assertEquals(effortOf("light"), "low");
  // A higher tier and a mid tier emit distinct signals (SC-002).
  assert(effortOf("heavy") !== effortOf("mid"));
  // Absent / inherit / unrecognised tiers omit the field so Codex inherits
  // the parent session default (FR-003) — and the file stays valid TOML.
  for (const name of ["none", "inherit", "weird"]) {
    const parsed = parseToml(mapped[`.codex/agents/${name}.toml`]!.content);
    assertEquals("model_reasoning_effort" in parsed, false, `${name} should omit effort`);
    assertEquals(parsed.name, name); // file is still valid & discoverable
  }
});

Deno.test("CodexHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CodexHarness emits no Claude/Cursor artefacts", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/ keys allowed");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/ keys allowed");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md allowed");
});

Deno.test("CodexHarness injects name+description into SKILL.md when absent", () => {
  const core: CoreBundle = [{
    category: "skill",
    name: "specflow-auto",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core, { backlogBackend: "local", versionScheme: "semver" });
  const skill = mapped[".agents/skills/specflow-auto/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specflow-auto"));
});
