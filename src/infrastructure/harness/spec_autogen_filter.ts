import type { CoreEntry } from "../../domain/core_bundle.ts";
import type { BundleOptions } from "../../application/ports.ts";
import { renderSpecAutogen } from "../../domain/conditional_render.ts";

/**
 * Renders `<!-- BEGIN: spec-autogen=on -->` blocks in the `backlog-skill`
 * entry against the opt-in auto-generation toggle (spec 021 / FR-005). The
 * guidance is kept only when `specAutogen && specBackend === "cloud"` — auto-
 * generation runs the branch-free cloud `specify` path, which only exists in
 * cloud mode, so the spec backend is part of the gate. Every other category
 * (and a disabled toggle) passes through unchanged, so a project that never
 * enabled it sees byte-identical output. Sibling of {@link applySpecBackend}.
 *
 * Idempotent and pure — no IO, no Deno globals.
 */
export function applySpecAutogen(entry: CoreEntry, opts: BundleOptions): CoreEntry {
  if (entry.category !== "backlog-skill") return entry;
  const enabled = (opts.specAutogen ?? false) && opts.specBackend === "cloud";
  return {
    ...entry,
    content: renderSpecAutogen(entry.content, enabled),
  };
}
