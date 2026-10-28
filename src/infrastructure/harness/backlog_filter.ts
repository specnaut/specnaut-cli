import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/bundle_options.ts";
import { renderBackend, renderHarness } from "../../domain/conditional_render.ts";

/**
 * Returns the entry tailored to the active backend, or `null` when the
 * entry only applies to a different backend (e.g. github-only scripts when
 * the user picked local).
 *
 * For `backlog-skill` entries, the conditional sections are rendered so
 * the on-disk SKILL.md only shows the relevant flow.
 */
export function applyBackend(
  entry: CoreEntry,
  opts: BundleOptions,
): CoreEntry | null {
  if (
    entry.backend !== null &&
    entry.backend !== undefined &&
    entry.backend !== opts.backlogBackend
  ) {
    return null;
  }
  // `backlog-doc` carries the same per-backend conditional sections as the
  // SKILL.md it sits beside — groom's field-vs-label persistence differs by
  // backend — so it renders through the same path. So does a Markdown file at
  // the project root: the root `AGENTS.md` carries the backlog pointer since
  // cli#680 moved it there from the harness context files, and a pointer to all
  // four backends at once sends a project to files it never received.
  if (
    entry.category === "backlog-skill" || entry.category === "backlog-doc" ||
    (entry.category === "project-root" && entry.suffix?.endsWith(".md") === true)
  ) {
    return {
      ...entry,
      content: renderBackend(entry.content, opts.backlogBackend),
    };
  }
  return entry;
}

/**
 * The entry as `harnessKey` receives it: a Markdown file at the project root
 * keeps only its own `harness=` sections (cli#680). Every adapter calls this
 * before `applyBackend`, so the rule has one home rather than seven.
 */
export function applyHarness(entry: CoreEntry, harnessKey: string): CoreEntry {
  if (entry.category !== "project-root" || entry.suffix?.endsWith(".md") !== true) return entry;
  return { ...entry, content: renderHarness(entry.content, harnessKey) };
}

/**
 * Uniform destination for any `backlog-script` entry — same path for every
 * harness. The skill markdown references scripts via this path so the
 * skill stays portable across harnesses.
 */
export function backlogScriptDestination(entry: CoreEntry): string {
  if (entry.category !== "backlog-script") {
    throw new Error(`backlogScriptDestination called on non-script entry: ${entry.category}`);
  }
  if (!entry.suffix) {
    throw new Error(`backlog-script needs suffix: ${entry.name}`);
  }
  return `.specnaut/scripts/backlog/${entry.suffix}`;
}
