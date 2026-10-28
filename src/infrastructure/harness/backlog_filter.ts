import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/bundle_options.ts";
import { renderBackend } from "../../domain/conditional_render.ts";

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
  // backend — so it renders through the same path.
  if (entry.category === "backlog-skill" || entry.category === "backlog-doc") {
    return {
      ...entry,
      content: renderBackend(entry.content, opts.backlogBackend),
    };
  }
  return entry;
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
