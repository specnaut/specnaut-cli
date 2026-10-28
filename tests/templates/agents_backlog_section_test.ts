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

Deno.test("each harness-only integration list reaches its harness, and only it", () => {
  // The root AGENTS.md ships to every harness: a list about one harness's own
  // folders would send the others to paths they never received (#656). Each
  // list still says which harness it is for, where it lands.
  const LABEL: Record<string, string> = {
    claude: "**Claude Code only:**",
    codex: "**Codex only:**",
  };
  const wrong: string[] = [];
  for (const harness of HARNESSES) {
    const agents = harness.mapBundle(CORE_BUNDLE, optsFor("local"))["AGENTS.md"]!.content;
    const body = extractBlock(agents, "optional-integrations", "html") ?? "";
    for (const [owner, label] of Object.entries(LABEL)) {
      if (body.includes(label) !== (owner === harness.key)) {
        wrong.push(`${harness.key}: ${label} ${owner === harness.key ? "missing" : "leaked"}`);
      }
    }
    if (agents.includes("harness=")) wrong.push(`${harness.key}: markers left in AGENTS.md`);
    if (body.includes("/docs/fr/")) wrong.push(`${harness.key}: a localised docs URL survived`);
  }
  assertEquals(wrong, []);
});
