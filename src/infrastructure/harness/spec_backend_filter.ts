import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/ports.ts";
import { renderSpecBackend } from "../../domain/conditional_render.ts";

/**
 * Renders `<!-- BEGIN: spec-backend=X -->` blocks in a `phase` entry against the
 * active spec backend. `specify.md` / `implement.md` carry these markers since
 * spec 020; `review.md` / `analyze.md` / `tasks.md` gained a cloud pull-on-entry
 * block in spec 021. Every phase doc is filtered here (the guard is category,
 * not name), and any phase without markers — plus every non-phase category —
 * passes through unchanged, so `local` output stays byte-identical to the
 * pre-feature CLI (FR-003). Sibling of {@link applyScheme}.
 *
 * Idempotent and pure — no IO, no Deno globals.
 */
export function applySpecBackend(entry: CoreEntry, opts: BundleOptions): CoreEntry {
  if (entry.category !== "phase") return entry;
  return {
    ...entry,
    content: renderSpecBackend(entry.content, opts.specBackend),
  };
}
