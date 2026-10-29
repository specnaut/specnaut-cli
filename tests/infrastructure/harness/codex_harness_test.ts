import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specnaut",
    suffix: null,
    content: "---\nname: specnaut\ndescription: Specnaut router\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "phase",
    name: "specnaut",
    suffix: "specify.md",
    content: "# Specify phase\n",
    executable: false,
  },
  {
    category: "skill",
    name: "specnaut-auto",
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
    suffix: "memory/size-limits.md",
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

Deno.test("CodexHarness maps router skill to .agents/skills/specnaut/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".agents/skills/specnaut/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps phase docs under .agents/skills/specnaut/phases/", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".agents/skills/specnaut/phases/specify.md" in mapped);
});

Deno.test("CodexHarness maps skill to .agents/skills/specnaut-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".agents/skills/specnaut-auto/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps agent to .codex/agents/<name>.toml with valid TOML", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
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
  // No model version is pinned (cli#707): the family is a comment; `tools` is dropped.
  assertEquals("model" in parsed, false);
  assert(agentToml.content.startsWith("# Model family: Sol (opus on Claude Code)\n"));
  assertEquals("tools" in parsed, false);
});

Deno.test("CodexHarness names the family, pins no model, and maps the effort", () => {
  const agent = (
    name: string,
    model: string | null,
    effort: string | null,
  ): CoreBundle[number] => ({
    category: "agent",
    name,
    suffix: null,
    content: `---\nname: ${name}\ndescription: ${name} role\n${
      model === null ? "" : `model: ${model}\n`
    }${effort === null ? "" : `effort: ${effort}\n`}tools: Read\n---\n\n# Body\n`,
    executable: false,
  });
  const core: CoreBundle = [
    agent("deep", "opus", "xhigh"),
    agent("standard", "opus", "high"),
    agent("mid", "sonnet", "medium"),
    agent("light", "haiku", "low"),
    agent("top", "fable", "high"),
    agent("no-model", null, "high"),
    agent("inherit", "inherit", "inherit"),
    agent("weird", "gpt-9-ultra", "cosmic"),
  ];
  const mapped = new CodexHarness().mapBundle(core, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const file = (name: string) => {
    const f = mapped[`.codex/agents/${name}.toml`];
    assert(f, `${name} TOML not emitted`);
    return f.content;
  };
  const toml = (name: string) => parseToml(file(name));
  const family = (name: string) => file(name).match(/^# Model family: (\w+)/)?.[1] ?? null;

  // Families, never ids (cli#707): no emitted agent carries a `model` key.
  for (const name of ["deep", "standard", "mid", "light", "top", "no-model", "inherit", "weird"]) {
    assertEquals("model" in toml(name), false, `${name} pins a model`);
  }
  assertEquals(family("deep"), "Sol");
  assertEquals(family("mid"), "Terra");
  assertEquals(family("light"), "Luna");
  assertEquals(family("top"), "Astra");
  // Absent / inherit / unrecognised: no family named, no guess.
  assertEquals(family("no-model"), null);
  assertEquals(family("inherit"), null);
  assertEquals(family("weird"), null);

  // The effort crosses verbatim, and two agents of one family keep distinct budgets.
  assertEquals(toml("deep").model_reasoning_effort, "xhigh");
  assertEquals(toml("standard").model_reasoning_effort, "high");
  assertEquals(toml("mid").model_reasoning_effort, "medium");
  assertEquals(toml("light").model_reasoning_effort, "low");
  assertEquals(toml("no-model").model_reasoning_effort, "high");
  assertEquals("model_reasoning_effort" in toml("inherit"), false);
  assertEquals("model_reasoning_effort" in toml("weird"), false);
});

Deno.test("CodexHarness maps spec-root to .specnaut/<suffix> and project-root to <suffix>", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".specnaut/memory/size-limits.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CodexHarness links .codex/AGENTS.md to the root and no longer writes goal.md (cli#681)", () => {
  const mapped = new CodexHarness().mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assertEquals(mapped[".codex/AGENTS.md"]?.symlinkTo, "../AGENTS.md");
  assert(!(".codex/goal.md" in mapped), "goal.md is retired: /goal reads no file");
  // Still retirable: the orphan path admits it by exact name.
  assert(new CodexHarness().managedFiles.includes(".codex/goal.md"));
});

Deno.test("CodexHarness emits no Claude/Cursor artefacts", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/ keys allowed");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/ keys allowed");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md allowed");
});

Deno.test("CodexHarness injects name+description into SKILL.md when absent", () => {
  const core: CoreBundle = [{
    category: "skill",
    name: "specnaut-auto",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const skill = mapped[".agents/skills/specnaut-auto/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specnaut-auto"));
});
