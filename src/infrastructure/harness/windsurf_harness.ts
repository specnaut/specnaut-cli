import { managedSectionField } from "./harness_managed.ts";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";

// Cascade ignores Claude-only frontmatter fields (e.g. `color:`). Strip them
// before emission so they don't eat into the 12k-char workflow cap.
function stripCascadeIgnoredFields(content: string): string {
  const split = splitFrontmatter(content);
  if (!split) return content;
  const cleaned = split.fmBody
    .split("\n")
    .filter((line) => !/^color\s*:/.test(line))
    .join("\n");
  return `---\n${cleaned}\n---\n${split.rest}`;
}

/**
 * Windsurf's per-workflow cap, in **characters**.
 *
 * The unit is load-bearing and was never established until #539. The vendor
 * page says, verbatim: "Workflow files are limited to 12000 characters each."
 * Characters — not bytes. This repo is dense with em dashes and arrows, so the
 * two measures diverge by roughly 1.7%, and four emitted workflows sit inside
 * that gap: over 12,000 bytes and under it in characters. Read as bytes they
 * would have been shipping truncated for months; read as characters, correctly,
 * they are fine. Nothing recorded which reading applied.
 *
 * Measure with {@link workflowLength}, not `String.length`: that counts UTF-16
 * code units, which exceeds the character count wherever an astral-plane
 * character appears (any emoji costs 2). Conservative rather than wrong, but
 * "conservative" is a claim nobody had checked either.
 *
 * The vendor documents **no** failure mode — not truncation, not an error, not
 * rejection. The previous version of this comment asserted silent truncation;
 * that was never sourced, and it is why the margin was treated as a hard cliff
 * rather than an unknown. Stay under it; do not rely on what happens above it.
 *
 * Documented at https://docs.devin.ai/desktop/cascade/workflows
 * (https://docs.windsurf.com/windsurf/cascade/workflows now redirects there).
 */
export const WINDSURF_WORKFLOW_MAX_CHARS = 12_000;

/**
 * Editing room kept back under the cap. Module-private on purpose — see below.
 *
 * **Why a reserve exists.** Six emitted workflows once sat within 100
 * characters of the cap. At that margin any routine edit fails the build, and
 * the only remedy available in the moment is deleting unrelated content from
 * the same file to buy characters back. That happened twice in one day: one
 * seat had 23 characters of room, so the content reclaimed to pay for a
 * one-line change had nothing to do with the change (#561, #562).
 *
 * **Why 300.** It catches exactly the same set of files a 500-character reserve
 * does, at 60% of the cut — the sizes cluster, so the extra 200 characters buy
 * no additional file and are paid for by cutting deeper into seats a security
 * review had just named as dangerous to cut. A 200-character reserve leaves the
 * next file down with 82 characters of real slack, less than the reserve
 * itself, which makes the reserve a fiction one file in.
 *
 * **Why this lives in production source when no production code reads it.**
 * Its justification is the cap's own comment directly above: the reserve exists
 * *because* the vendor documents no failure mode above 12,000, so the margin is
 * an unknown rather than a cliff. Splitting the number from that paragraph is
 * worse than a test-only export, and this file already exports
 * {@link workflowLength}, which no `src/` caller uses either.
 *
 * Not exported: a call site that can see the reserve can spell
 * `MAX - RESERVE`, and then the budget has two homes. Export the budget.
 */
const WINDSURF_WORKFLOW_RESERVE_CHARS = 300;

/**
 * What an emitted workflow is actually held to: the cap minus the reserve.
 *
 * Derived, never written down twice. Failing here still leaves ~300 characters
 * before anything Windsurf does — which is the point: the build breaks while
 * there is still room to plan a trim, instead of at the moment there is none.
 */
export const WINDSURF_WORKFLOW_BUDGET_CHARS = WINDSURF_WORKFLOW_MAX_CHARS -
  WINDSURF_WORKFLOW_RESERVE_CHARS;

/**
 * The one description of a workflow that is too long. One builder, not a string
 * spelled at each assertion: a second site writing its own message reports no
 * path, no deficit, no combination — and calls a budget a "cap".
 */
export function describeOversizeWorkflow(
  path: string,
  content: string,
  where: string,
): string {
  const chars = workflowLength(content);
  return `${path} is ${chars} characters, over the ${WINDSURF_WORKFLOW_BUDGET_CHARS} budget ` +
    `by ${chars - WINDSURF_WORKFLOW_BUDGET_CHARS} (cap ${WINDSURF_WORKFLOW_MAX_CHARS}, ` +
    `reserve ${WINDSURF_WORKFLOW_MAX_CHARS - WINDSURF_WORKFLOW_BUDGET_CHARS}; ` +
    `${new TextEncoder().encode(content).length} bytes, ` +
    `${content.length} UTF-16 units) on ${where}`;
}

/**
 * Character count of an emitted workflow, in the unit the vendor's limit uses.
 * Counting code points rather than UTF-16 code units is the whole difference
 * between measuring the file and measuring its JavaScript representation.
 */
export function workflowLength(content: string): number {
  return [...content].length;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.windsurf/workflows/${skillFolderName(entry)}.md`;
    case "backlog-doc":
    case "phase":
      // Windsurf is flat — no nested skill folders. A sub-document becomes a
      // sibling workflow whose name carries its owner as the prefix, which is
      // the only thing disambiguating two skills' documents here.
      return skillDocDestination(entry, SKILL_SURFACE.windsurf.layout);
    case "phase-script":
      return phaseScriptDestination(entry);
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "agent-memory":
      throw new Error("agent-memory entries should be filtered before destinationFor");
    case "agent-doc":
      throw new Error("agent-doc entries should be filtered before destinationFor");
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specnaut/${entry.suffix}`;
    case "project-root":
    case "mergeable-project-root":
      if (!entry.suffix) throw new Error(`${entry.category} needs suffix`);
      return entry.suffix;
  }
}

export class WindsurfHarness implements Harness {
  readonly key = "windsurf";
  readonly displayName = "Windsurf";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(raw, opts);
      if (backendApplied === null) continue;
      const entry = applySpecAutogen(
        applySpecBackend(applyScheme(backendApplied, opts), opts),
        opts,
      );
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      addUnique(out, destinationFor(entry), {
        content: stripCascadeIgnoredFields(entry.content),
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
        ...managedSectionField(entry),
      }, this.key);
    }
    // Layer the harness's own static files last, so a harness-specific file
    // wins over anything the core bundle mapped to the same destination.
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
