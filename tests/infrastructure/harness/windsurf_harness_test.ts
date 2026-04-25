import { assert, assertEquals } from "@std/assert";
import { WindsurfHarness } from "../../../src/infrastructure/harness/windsurf_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# Body\n",
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
    content: "---\nname: product-owner\ndescription: Product Owner role\n---\n\nYou are the PO.\n",
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

Deno.test("WindsurfHarness.key and displayName", () => {
  const h = new WindsurfHarness();
  assertEquals(h.key, "windsurf");
  assertEquals(h.displayName, "Windsurf");
});

Deno.test("WindsurfHarness maps commands to .windsurf/workflows/specflow-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-specify.md" in mapped);
});

Deno.test("WindsurfHarness maps backlog-cmd to .windsurf/workflows/specflow-backlog.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-backlog.md" in mapped);
});

Deno.test("WindsurfHarness maps skill to .windsurf/workflows/specflow-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-speckit.md" in mapped);
});

Deno.test("WindsurfHarness maps agents to .windsurf/workflows/specflow-agent-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-agent-product-owner.md" in mapped);
});

Deno.test("WindsurfHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("WindsurfHarness emits content byte-identical to entry.content (no frontmatter rewrite)", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  const cmd = mapped[".windsurf/workflows/specflow-specify.md"];
  assertEquals(cmd.content, SAMPLE[0].content);
  const agent = mapped[".windsurf/workflows/specflow-agent-product-owner.md"];
  assertEquals(agent.content, SAMPLE[3].content);
});

Deno.test("WindsurfHarness emits no Claude/Cursor/Codex/Gemini artefacts", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.some((k) => k.startsWith(".gemini/")), "no .gemini/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});
