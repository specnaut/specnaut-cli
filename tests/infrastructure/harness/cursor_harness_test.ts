import { assert, assertEquals } from "@std/assert";
import { CursorHarness } from "../../../src/infrastructure/harness/cursor_harness.ts";
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
    category: "agent",
    name: "product-owner",
    suffix: null,
    content: "---\ndescription: Product owner\n---\n\n# body\n",
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

Deno.test("CursorHarness.key and displayName", () => {
  const h = new CursorHarness();
  assertEquals(h.key, "cursor");
  assertEquals(h.displayName, "Cursor");
});

Deno.test("CursorHarness maps router skill to .cursor/skills/specnaut/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/skills/specnaut/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps phase docs under .cursor/skills/specnaut/phases/", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/skills/specnaut/phases/specify.md" in mapped);
});

Deno.test("CursorHarness maps the backlog command to .cursor/skills/specnaut-backlog/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/skills/specnaut-backlog/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps agents to .cursor/skills/specnaut-agent-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/skills/specnaut-agent-product-owner/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps skills to .cursor/skills/specnaut-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/skills/specnaut-auto/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps spec-root to .specflow/ and project-root unchanged", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CursorHarness includes .cursor/rules/specify-rules.mdc from HARNESS_STATIC", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE, { backlogBackend: "local", versionScheme: "semver" });
  assert(".cursor/rules/specify-rules.mdc" in mapped);
});
