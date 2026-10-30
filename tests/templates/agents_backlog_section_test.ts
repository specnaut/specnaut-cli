import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { KNOWN_BACKLOG_BACKENDS } from "../../src/domain/installed_lock.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import { managedSectionLabels } from "../../src/domain/template.ts";

/**
 * The root AGENTS.md carries what the harness context files used to (cli#680,
 * cli#681): the backlog pointer and the optional integrations, each in a
 * managed section so an upgrade delivers it to an existing project.
 */

const optsFor = (backlogBackend: (typeof KNOWN_BACKLOG_BACKENDS)[number]) => ({
  backlogBackend,
  versionScheme: "semver" as const,
  specBackend: "local" as const,
  specAutogen: false,
});

Deno.test("the backlog section names the backend the project uses, on every harness", () => {
  // AGENTS.md was not backend-rendered before this section moved in: all four
  // backends' lines reached every project, markers and all.
  const wrong: string[] = [];
  for (const harness of HARNESSES) {
    for (const backend of KNOWN_BACKLOG_BACKENDS) {
      const agents = harness.mapBundle(CORE_BUNDLE, optsFor(backend))["AGENTS.md"];
      const body = agents === undefined ? null : extractBlock(agents.content, "backlog", "html");
      const at = `${harness.key} × ${backend}`;
      if (body === null) {
        wrong.push(`${at}: no backlog section`);
        continue;
      }
      if (agents!.content.includes("backend=")) wrong.push(`${at}: markers left in AGENTS.md`);
      if (body.includes("`.specnaut/backlog.md`") !== (backend === "local")) {
        wrong.push(`${at}: backlog.md cited wrongly`);
      }
      if (body.includes("`.specnaut/backlog-config.yml`") === (backend === "local")) {
        wrong.push(`${at}: backlog-config.yml cited wrongly`);
      }
      if (!body.includes("backlog-reference-contract")) wrong.push(`${at}: no reference pointer`);
    }
  }
  assertEquals(wrong, []);
});

Deno.test("the moved sections are declared, so upgrade grafts them", () => {
  const root = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(root);
  const labels = managedSectionLabels(root!.managedSection);
  for (const label of ["backlog", "optional-integrations"]) {
    assert(labels.includes(label), `${label} not declared: ${JSON.stringify(labels)}`);
  }
});

Deno.test("the backlog reference pointer is said once, inside the fence", () => {
  // It sat unfenced at the top of the template, reaching new projects only.
  const root = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md")!;
  assertEquals(root.content.split("backlog-reference-contract").length - 1, 1);
});

/**
 * cli#679 moved the integrations tour out of the always-on file: its managed
 * section is one pointer line per design-target harness, and the reference
 * lives in `specnaut-facts/integrations.md`. The label stays, so an upgrade
 * refreshes the old body away instead of leaving ~75 lines behind.
 */
const POINTER: Record<string, string> = {
  claude: "`.claude/skills/specnaut-facts/integrations.md`",
  codex: "`.agents/skills/specnaut-facts/integrations.md`",
};

Deno.test("each harness's integrations pointer reaches its harness, and only it", () => {
  // The root AGENTS.md ships to every harness: a pointer into one harness's own
  // folders would send the others to paths they never received (#656).
  const wrong: string[] = [];
  for (const harness of HARNESSES) {
    const bundle = harness.mapBundle(CORE_BUNDLE, optsFor("local"));
    const agents = bundle["AGENTS.md"]!.content;
    const body = extractBlock(agents, "optional-integrations", "html") ?? "";
    for (const [owner, pointer] of Object.entries(POINTER)) {
      if (body.includes(pointer) !== (owner === harness.key)) {
        wrong.push(`${harness.key}: ${pointer} ${owner === harness.key ? "missing" : "leaked"}`);
      }
    }
    const own = POINTER[harness.key];
    if (own !== undefined && bundle[own.replaceAll("`", "")] === undefined) {
      wrong.push(`${harness.key}: ${own} is cited but not written`);
    }
    if (body.split("\n").filter((l) => l.includes("integrations.md")).length > 1) {
      wrong.push(`${harness.key}: more than one pointer line`);
    }
    if (agents.includes("harness=")) wrong.push(`${harness.key}: markers left in AGENTS.md`);
  }
  assertEquals(wrong, []);
});

Deno.test("the integrations reference lives in specnaut-facts, for both harnesses", () => {
  const doc = CORE_BUNDLE.find((e) => e.name === "specnaut-facts" && e.suffix === "integrations.md")
    ?.content;
  assert(doc, "no specnaut-facts/integrations.md in the bundle");
  for (
    const text of [
      "## Claude Code",
      "## Codex",
      "`/loop 1h`",
      "`.claude/loop.md`",
      "https://code.claude.com/docs/en/goal",
      "Multi-session dispatch (`claude agents`)",
      "https://code.claude.com/docs/en/agent-view",
      "`.claude/worktrees/`",
      "`.claude/scripts/dispatch-agent.sh",
      "`/goal <objective>`",
      "https://learn.chatgpt.com/use-cases/follow-goals",
    ]
  ) assert(doc!.includes(text), `integrations.md lost ${text}`);
  // No filter runs on a skill document, so no marker may reach it; no harness
  // version (constitution § VIII); and no example naming Specnaut's own board
  // or toolchain (cli#687).
  assert(!doc!.includes("harness="), "harness markers in integrations.md");
  assert(!/v[0-9]+\.[0-9]+/.test(doc!), "a version pin in integrations.md");
  for (const leak of ["Specnaut Project", "deno task"]) {
    assert(!doc!.includes(leak), `integrations.md names ${leak}`);
  }
  assert(!doc!.includes("/docs/fr/"), "a localised docs URL survived");
  const facts = CORE_BUNDLE.find((e) => e.category === "skill" && e.name === "specnaut-facts");
  assert(facts?.content.includes("`integrations.md`"), "specnaut-facts does not name the file");
});

Deno.test("the integrations section says something on every harness, not a bare heading", () => {
  // Only Claude Code and Codex carry a pointer; without a harness-neutral line the
  // section rendered heading-only on every other harness.
  const empty: string[] = [];
  for (const harness of HARNESSES) {
    const agents = harness.mapBundle(CORE_BUNDLE, optsFor("local"))["AGENTS.md"]!.content;
    const prose = (extractBlock(agents, "optional-integrations", "html") ?? "").split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("*Owned by Specnaut"));
    if (prose.length === 0) empty.push(harness.key);
  }
  assertEquals(empty, []);
});
