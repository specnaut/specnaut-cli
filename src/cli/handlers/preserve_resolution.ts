import { type PreserveConfig } from "../../domain/preserve_config.ts";

/**
 * Result of reconciling a parsed preserve manifest against the actual bundle
 * destinations for a refresh run (spec 011 / issue #367).
 *
 * Splitting "known" from "unknown" is the FR-008 seam: a declared path that
 * is not a managed bundle file is ineffective — it must surface exactly one
 * `warn:` line and be filtered out, never silently honoured nor treated as
 * fatal.
 */
export type PreserveResolution = {
  /** Declared paths that are real bundle dests — these are actually preserved. */
  readonly known: ReadonlyArray<string>;
  /** Declared paths absent from the bundle — ineffective, warned, filtered out. */
  readonly unknown: ReadonlyArray<string>;
};

/**
 * Reconcile preserve declarations against the bundle's destination paths.
 *
 * `bundleDests` is `Object.keys(bundle)` for the run. Membership is exact
 * (the manifest is already normalised to the bundle's project-relative,
 * forward-slash form by `parsePreserveConfig`). Declaration order is
 * preserved in both partitions so notices/warnings render deterministically.
 *
 * Pure — no I/O, no CLI flag awareness; the `--reset-preserved` opt-out is a
 * handler concern applied to the resulting set, not here.
 */
export function resolvePreserveDeclarations(
  cfg: PreserveConfig,
  bundleDests: Iterable<string>,
): PreserveResolution {
  const dests = new Set(bundleDests);
  const known: string[] = [];
  const unknown: string[] = [];
  for (const path of cfg.preserved) {
    if (dests.has(path)) known.push(path);
    else unknown.push(path);
  }
  return { known, unknown };
}
