import { assert, assertEquals } from "@std/assert";
import { WindsurfHarness } from "../../../src/infrastructure/harness/windsurf_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { WINDSURF_WORKFLOW_MAX_CHARS } from "../../../src/infrastructure/harness/windsurf_harness.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specnaut",
    suffix: null,
    content: "---\nname: specnaut\ndescription: Specnaut router\n---\n\n# Body\n",
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
    name: "specnaut-auto",
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

Deno.test("WindsurfHarness maps router skill to .windsurf/workflows/specnaut.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".windsurf/workflows/specnaut.md" in mapped);
});

Deno.test("WindsurfHarness maps phase docs to sibling specnaut-<phase>.md files", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".windsurf/workflows/specnaut-specify.md" in mapped);
});

Deno.test("WindsurfHarness maps backlog-cmd to .windsurf/workflows/specnaut-backlog.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".windsurf/workflows/specnaut-backlog.md" in mapped);
});

Deno.test("WindsurfHarness maps skill to .windsurf/workflows/specnaut-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".windsurf/workflows/specnaut-auto.md" in mapped);
});

Deno.test("WindsurfHarness maps agents to .windsurf/workflows/specnaut-agent-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".windsurf/workflows/specnaut-agent-product-owner.md" in mapped);
});

Deno.test("WindsurfHarness maps spec-root to .specnaut/<suffix> and project-root to <suffix>", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".specnaut/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("WindsurfHarness emits content byte-identical to entry.content (no frontmatter rewrite)", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  const router = mapped[".windsurf/workflows/specnaut.md"];
  assertEquals(router.content, SAMPLE[0].content);
  const phase = mapped[".windsurf/workflows/specnaut-specify.md"];
  assertEquals(phase.content, SAMPLE[1].content);
});

Deno.test("WindsurfHarness emits no Claude/Cursor/Codex artefacts", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});

Deno.test("WindsurfHarness emits no workflow exceeding the Cascade cap", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(CORE_BUNDLE, { backlogBackend: "local", versionScheme: "semver" });
  for (const [path, file] of Object.entries(mapped)) {
    if (!path.startsWith(".windsurf/workflows/")) continue;
    assert(
      file.content.length <= WINDSURF_WORKFLOW_MAX_CHARS,
      `${path} exceeds ${WINDSURF_WORKFLOW_MAX_CHARS} chars: ${file.content.length}`,
    );
  }
});
