import { assert, assertEquals } from "@std/assert";
import { CopilotHarness } from "../../../src/infrastructure/harness/copilot_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specflow",
    suffix: null,
    content:
      "---\nname: specflow\ndescription: Specflow router\nmodel: opus\ntools: Read, Write\nmaxTurns: 30\n---\n\n# Body\n\nDo the thing.\n",
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

Deno.test("CopilotHarness maps router skill to .github/instructions/specflow.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".github/instructions/specflow.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps phase docs to .github/instructions/specflow-<phase>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".github/instructions/specflow-specify.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps backlog-cmd to .github/instructions/specflow-backlog.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".github/instructions/specflow-backlog.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps skill to .github/instructions/specflow-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".github/instructions/specflow-auto.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps agents to .github/instructions/specflow-agent-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".github/instructions/specflow-agent-product-owner.instructions.md" in mapped);
});

Deno.test('CopilotHarness rewrites instruction frontmatter to applyTo: "**" and strips Claude fields', () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  const cmd = mapped[".github/instructions/specflow.instructions.md"];
  assert(cmd, "instruction file not emitted");
  assert(cmd.content.startsWith("---\n"));
  assert(cmd.content.includes('applyTo: "**"'));
  assert(!cmd.content.includes("model: opus"), "model should be stripped");
  assert(!cmd.content.includes("tools:"), "tools should be stripped");
  assert(!cmd.content.includes("maxTurns"), "maxTurns should be stripped");
  assert(cmd.content.includes("Do the thing"), "body should be preserved");
});

Deno.test("CopilotHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CopilotHarness emits no Claude/Cursor/Codex/Gemini/Windsurf artefacts", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.some((k) => k.startsWith(".gemini/")), "no .gemini/");
  assert(!keys.some((k) => k.startsWith(".windsurf/")), "no .windsurf/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});
