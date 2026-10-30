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
    const pending = await pendingSection(
      reader,
      projectDir,
      dest,
      label,
      body,
      isDeclaredPreserved,
    );
    if (pending !== null) out.push({ dest, label, kind: pending.kind });
  }
  return out;
}

/**
 * Merges each managed section in, and reports only what actually changed.
 *
 * Each entry is judged on a fresh read, after the plan's writes and after the
 * previous label's merge into the same file (#576) — so the report says what
 * the file now holds, and one label's graft is never written over by the next.
 */
export async function applyManagedSections(
  deps: { readonly reader: FsReader; readonly writer: FsWriter },
  bundle: Bundle,
  projectDir: string,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<ManagedSectionOutcome[]> {
  const out: ManagedSectionOutcome[] = [];
  for (const [dest, label, body] of managedSectionEntries(bundle)) {
    const pending = await pendingSection(
      deps.reader,
      projectDir,
      dest,
      label,
      body,
      isDeclaredPreserved,
    );
    if (pending === null) continue;
    const merged = mergeIntoFile(pending.existing, body, label, "html");
    if (merged === pending.existing) continue;
    await deps.writer.writeBundle(
      { [dest]: { content: merged, executable: false } },
      projectDir,
      { overwrite: true, backupExisting: false },
    );
    out.push({ dest, label, kind: pending.kind });
  }
  return out;
}

/**
 * Whether one section still has to reach its file — the one filter survey and
 * apply share — with the file as read and what the graft would be.
 *
 * Not when the file is declared preserved: that wins over everything, `--force`
 * included (spec 011 / #367, FR-009). #466 grafted its section straight off the
 * bundle and never consulted the predicate, so a frozen file was written anyway
 * and the same run printed both "preserved … declared" and "added the …
 * section"; only `--reset-preserved` lifts it, by flipping the predicate in the
 * handler. Not when the file is absent — the plan writes it whole — nor when
 * the block already equals the bundle's.
 */
async function pendingSection(
  reader: FsReader,
  projectDir: string,
  dest: string,
  label: string,
  body: string,
  isDeclaredPreserved: (dest: string) => boolean,
): Promise<{ existing: string; kind: ManagedSectionOutcome["kind"] } | null> {
  if (isDeclaredPreserved(dest)) return null;
  const existing = await reader.readText(projectDir, dest);
  if (existing === null) return null;
  const current = extractBlock(existing, label, "html");
  if (current === body) return null;
  return { existing, kind: current === null ? "added" : "refreshed" };
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
