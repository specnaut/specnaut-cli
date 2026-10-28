import type { FsReader, FsWriter } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import { managedSectionLabels } from "../domain/template.ts";
import { extractBlock, mergeIntoFile } from "../domain/merge_block.ts";

/**
 * The sections Specnaut owns inside files the user owns (#466), as `upgrade`
 * surveys and grafts them. They live outside the plan on purpose: `AGENTS.md`
 * is `skipIfExists`, so an upgrade never writes it — which is correct for the
 * file and wrong for the one section that has to reach a project that upgrades
 * rather than inits.
 */

/**
 * What `upgrade` did to a Specnaut-owned section inside a user-owned file
 * (#466). Reported so the run ends with the user either having the section or
 * being told, in the same output, that they do not.
 */
export type ManagedSectionOutcome = {
  readonly dest: string;
  readonly label: string;
  /** `added` — the file had no such block. `refreshed` — it did, and it moved. */
  readonly kind: "added" | "refreshed";
};

/**
 * What the managed sections would need, without writing anything. A
 * destination that does not exist yet is not listed: the plan writes that
 * file whole, fences included.
 */
export async function surveyManagedSections(
  reader: FsReader,
  bundle: Bundle,
  projectDir: string,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<ManagedSectionOutcome[]> {
  const out: ManagedSectionOutcome[] = [];
  for (const [dest, label, body] of managedSectionEntries(bundle)) {
    if (isDeclaredPreserved(dest)) continue;
    const existing = await reader.readText(projectDir, dest);
    if (existing === null) continue;
    const current = extractBlock(existing, label, "html");
    if (current === body) continue;
    out.push({ dest, label, kind: current === null ? "added" : "refreshed" });
  }
  return out;
}

/** Merges each managed section in, and reports only what actually changed. */
export async function applyManagedSections(
  deps: { readonly reader: FsReader; readonly writer: FsWriter },
  bundle: Bundle,
  projectDir: string,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<ManagedSectionOutcome[]> {
  const out: ManagedSectionOutcome[] = [];
  for (const [dest, label, body] of managedSectionEntries(bundle)) {
    // A declared preserve wins over everything, `--force` included (spec 011
    // / #367, FR-009). #466 grafted its section straight off the bundle and
    // never consulted the predicate, so a file the maintainer had frozen was
    // written anyway — and the same run printed both "preserved … declared"
    // and "added the … section" for it. Only `--reset-preserved` lifts this,
    // and it does so by flipping the predicate in the handler.
    if (isDeclaredPreserved(dest)) continue;
    const existing = await deps.reader.readText(projectDir, dest);
    if (existing === null) continue;
    const current = extractBlock(existing, label, "html");
    if (current === body) continue;
    const merged = mergeIntoFile(existing, body, label, "html");
    if (merged === existing) continue;
    await deps.writer.writeBundle(
      { [dest]: { content: merged, executable: false } },
      projectDir,
      { overwrite: true, backupExisting: false },
    );
    out.push({ dest, label, kind: current === null ? "added" : "refreshed" });
  }
  return out;
}

/**
 * Bundle entries declaring a managed section, as `[dest, label, body]`. The
 * body is the fenced region of the *bundled* template — an entry whose fences
 * are missing is dropped here, but it cannot reach a released binary:
 * `scripts/bundle-templates.ts` fails the build on that exact mismatch.
 */
function managedSectionEntries(bundle: Bundle): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const [dest, file] of Object.entries(bundle)) {
    // A destination may declare several labels (#576). Each is grafted
    // independently, so one being unfenced never silently suppresses another.
    for (const label of managedSectionLabels(file.managedSection)) {
      const body = extractBlock(file.content, label, "html");
      if (body === null || body.length === 0) continue;
      out.push([dest, label, body]);
    }
  }
  return out;
}
