import type { FsWriter } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";

/**
 * The user-owned JSON files an upgrade grafts Specnaut's entries into
 * (`.claude/settings.json`, `.codex/hooks.json` — every `mergeJson` dest).
 *
 * They live outside the lock-tracked plan: Specnaut never overwrites them, so
 * there is no baseline to compare, and they are re-merged as a flat write on
 * every upgrade that writes — including the up-to-date one (plan § 10 H3). A
 * project already on the current release reaches its next upgrade through that
 * path, and a hook registration that moved would otherwise never reach it.
 */

/** What the re-merge did: notes for the person, and the dests whose content changed. */
export type JsonMergeOutcome = {
  readonly notes: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
};

/** Split a bundle into its JSON-merged dests and the rest, which the plan tracks. */
export function splitJsonMerged(bundle: Bundle): { jsonMerged: Bundle; planned: Bundle } {
  const jsonMerged: Bundle = {};
  const planned: Bundle = {};
  for (const [dest, file] of Object.entries(bundle)) {
    if (file.mergeJson !== undefined) jsonMerged[dest] = file;
    else planned[dest] = file;
  }
  return { jsonMerged, planned };
}

/**
 * Re-graft the bundled entries into whatever the user has on disk. Idempotent:
 * the flavors replace Specnaut's own entries and report `changed: false` when
 * nothing moved. A missing file is written from the bundle.
 */
export async function reMergeJsonFiles(
  writer: FsWriter,
  jsonMerged: Bundle,
  projectDir: string,
): Promise<JsonMergeOutcome> {
  if (Object.keys(jsonMerged).length === 0) return { notes: [], changed: [] };
  const report = await writer.writeBundle(jsonMerged, projectDir, {
    overwrite: true,
    backupExisting: false,
  });
  return { notes: report.notes ?? [], changed: report.mergedChanged ?? [] };
}
