import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/ports.ts";
import { renderScheme } from "../../domain/conditional_render.ts";

/**
 * Renders `# BEGIN: scheme=X` blocks in a `phase-script` entry against
 * the active versioning scheme. Entries from other categories pass
 * through unchanged.
 *
 * Idempotent and pure — no IO, no Deno globals.
 */
export function applyScheme(entry: CoreEntry, opts: BundleOptions): CoreEntry {
  if (entry.category !== "phase-script") return entry;
  return {
    ...entry,
    content: renderScheme(entry.content, opts.versionScheme),
  };
}

/**
 * Uniform destination for any `phase-script` entry — same path for every
 * harness. The phase docs reference scripts via this path so the
 * scaffolded tag/release commands stay portable across harnesses
 * (including the flat ones like Windsurf and Copilot that don't have a
 * `skills/<name>/` layout). Mirrors the `backlog-script` convention.
 */
export function phaseScriptDestination(entry: CoreEntry): string {
  if (entry.category !== "phase-script") {
    throw new Error(
      `phaseScriptDestination called on non-phase-script entry: ${entry.category}`,
    );
  }
  if (!entry.suffix) {
    throw new Error(`phase-script needs suffix: ${entry.name}`);
  }
  return `.specflow/scripts/release/${entry.suffix}`;
}
