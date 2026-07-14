import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/ports.ts";
import { renderSpecBackend } from "../../domain/conditional_render.ts";

/**
 * Renders `<!-- BEGIN: spec-backend=X -->` blocks in a `phase` entry against the
 * active spec backend (spec 020). Only `specify.md` / `implement.md` carry these
 * markers today; every other phase (and non-phase category) passes through
 * unchanged, so `local` output stays byte-identical to the pre-feature CLI
 * (FR-003). Sibling of {@link applyScheme}.
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
