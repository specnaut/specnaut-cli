import { assert, assertEquals } from "@std/assert";
import { CursorHarness } from "../../../src/infrastructure/harness/cursor_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\ndescription: Scaffold feature spec\n---\n\n# body\n",
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
    name: "auto-chain",
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

Deno.test("CursorHarness maps commands to .cursor/skills/specflow-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-specify/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps the backlog command to .cursor/skills/specflow-backlog/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps agents to .cursor/skills/specflow-agent-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-agent-product-owner/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps skills to .cursor/skills/specflow-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-auto-chain/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps spec-root to .specflow/ and project-root unchanged", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CursorHarness includes .cursor/rules/specify-rules.mdc from HARNESS_STATIC", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/rules/specify-rules.mdc" in mapped);
});
