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
  // The Claude `model` tier picks a Codex model id; `tools` is dropped.
  assertEquals(parsed.model, "gpt-5.6-sol"); // opus → Sol
  assertEquals("tools" in parsed, false);
});

Deno.test("CodexHarness maps the tier to a model and the effort to reasoning", () => {
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
    agent("deep", "opus", "xhigh"), // → Sol + xhigh
    agent("standard", "opus", "high"), // → Sol + high
    agent("mid", "sonnet", "medium"), // → Terra + medium
    agent("light", "haiku", "low"), // → Luna + low
    agent("no-model", null, "high"), // → model omitted, effort kept
    agent("no-effort", "opus", null), // → model kept, effort omitted
    agent("inherit", "inherit", "inherit"), // → both omitted
    agent("weird", "gpt-9-ultra", "cosmic"), // → both omitted, no guess
  ];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const toml = (name: string) => {
    const file = mapped[`.codex/agents/${name}.toml`];
    assert(file, `${name} TOML not emitted`);
    return parseToml(file.content);
  };

  assertEquals(toml("deep").model, "gpt-5.6-sol");
  assertEquals(toml("deep").model_reasoning_effort, "xhigh");
  assertEquals(toml("mid").model, "gpt-5.6-terra");
  assertEquals(toml("mid").model_reasoning_effort, "medium");
  assertEquals(toml("light").model, "gpt-5.6-luna");
  assertEquals(toml("light").model_reasoning_effort, "low");

  // The whole point of reading `effort:` rather than deriving it from the
  // model: two agents on the same tier must still emit distinct budgets.
  // While effort came from the tier, these two were indistinguishable — and
  // an all-Opus fleet made *every* agent indistinguishable.
  assertEquals(toml("standard").model, toml("deep").model);
  assert(
    toml("standard").model_reasoning_effort !== toml("deep").model_reasoning_effort,
    "same tier, different effort must not collapse to one budget",
  );

  // The two axes are independent — one being unresolvable never suppresses
  // the other.
  assertEquals("model" in toml("no-model"), false);
  assertEquals(toml("no-model").model_reasoning_effort, "high");
  assertEquals(toml("no-effort").model, "gpt-5.6-sol");
  assertEquals("model_reasoning_effort" in toml("no-effort"), false);

  // Absent / inherit / unrecognised omit the key so Codex inherits the parent
  // session default, and the file stays valid & discoverable.
  for (const name of ["inherit", "weird"]) {
    const parsed = toml(name);
    assertEquals("model" in parsed, false, `${name} should omit model`);
    assertEquals("model_reasoning_effort" in parsed, false, `${name} should omit effort`);
    assertEquals(parsed.name, name);
  }
});

Deno.test("CodexHarness maps spec-root to .specnaut/<suffix> and project-root to <suffix>", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".specnaut/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
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
