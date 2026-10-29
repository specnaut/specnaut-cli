import type { CoreEntry } from "../../domain/core_bundle.ts";
import { managedSectionLabels } from "../../domain/template.ts";

/**
 * The `managedSection` field for a mapped `TemplateFile`, or nothing.
 *
 * Every adapter used to spread `entry.managedSection ? {…} : {}` inline. That
 * is a SECOND resolution of the union with different semantics from
 * `managedSectionLabels`: truthiness treats `[]` as present and `""` as absent,
 * where the helper treats `[]` as none and `""` as one label. Seven adapters
 * each deciding that on their own is how two spellings of one rule drift —
 * which is the defect this contract's own decision table names.
 */
export function managedSectionField(
  entry: CoreEntry,
): { managedSection: string | readonly string[] } | Record<never, never> {
  const labels = managedSectionLabels(entry.managedSection);
  return labels.length > 0 ? { managedSection: labels } : {};
}

/**
 * The ownership flags of a mapped `TemplateFile`: `skipIfExists`, and
 * `projectOwned` with the `skipIfExists` it implies (spec 038, A-M6).
 *
 * The manifest carries `projectOwned` alone. Deriving the pair here, once,
 * is what keeps seven adapters from each spreading the flags by hand — one
 * that forgot `skipIfExists` would write the team's document on every
 * upgrade, before the writer's `projectOwned` guard is ever asked.
 */
export function ownershipFields(
  entry: CoreEntry,
): { skipIfExists?: true; projectOwned?: true } {
  if (entry.projectOwned === true) return { skipIfExists: true, projectOwned: true };
  return entry.skipIfExists === true ? { skipIfExists: true } : {};
}
