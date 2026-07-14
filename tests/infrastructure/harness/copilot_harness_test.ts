import { assert, assertEquals } from "@std/assert";
import { CopilotHarness } from "../../../src/infrastructure/harness/copilot_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specnaut",
    suffix: null,
    content:
      "---\nname: specnaut\ndescription: Specnaut router\nmodel: opus\ntools: Read, Write\nmaxTurns: 30\n---\n\n# Body\n\nDo the thing.\n",
    executable: false,
  },
  {
    category: "phase",
    name: "specify",
    suffix: "specify.md",
    content: "# Specify phase\n\nDo the specify thing.\n",
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
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\n---\n\nYou are the PO.\n",
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

Deno.test("CopilotHarness.key and displayName", () => {
  const h = new CopilotHarness();
  assertEquals(h.key, "copilot");
  assertEquals(h.displayName, "GitHub Copilot CLI");
});

Deno.test("CopilotHarness maps router skill to .github/instructions/specnaut.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".github/instructions/specnaut.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps phase docs to .github/instructions/specnaut-<phase>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".github/instructions/specnaut-specify.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps backlog-cmd to .github/instructions/specnaut-backlog.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".github/instructions/specnaut-backlog.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps skill to .github/instructions/specnaut-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".github/instructions/specnaut-auto.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps agents to .github/instructions/specnaut-agent-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".github/instructions/specnaut-agent-product-owner.instructions.md" in mapped);
});

Deno.test('CopilotHarness rewrites instruction frontmatter to applyTo: "**" and strips Claude fields', () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const cmd = mapped[".github/instructions/specnaut.instructions.md"];
  assert(cmd, "instruction file not emitted");
  assert(cmd.content.startsWith("---\n"));
  assert(cmd.content.includes('applyTo: "**"'));
  assert(!cmd.content.includes("model: opus"), "model should be stripped");
  assert(!cmd.content.includes("tools:"), "tools should be stripped");
  assert(!cmd.content.includes("maxTurns"), "maxTurns should be stripped");
  assert(cmd.content.includes("Do the thing"), "body should be preserved");
});

Deno.test("CopilotHarness maps spec-root to .specnaut/<suffix> and project-root to <suffix>", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".specnaut/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CopilotHarness emits no Claude/Cursor/Codex/Windsurf artefacts", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.some((k) => k.startsWith(".windsurf/")), "no .windsurf/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});
