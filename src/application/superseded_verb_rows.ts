import type { FsReader } from "./ports.ts";
import type { Bundle, TemplateFile } from "../domain/template.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { routedVerbs, rowVerb, verbRowDrops } from "../domain/router_verb_rows.ts";

/** The dests planned as unedited, and one line for each, quoting what goes. */
export type SupersededEdits = {
  readonly dests: ReadonlySet<string>;
  readonly notes: ReadonlyArray<string>;
};

/** Where the routers are read, and which dests the project declared preserved. */
export type SupersedeContext = {
  readonly reader: FsReader;
  readonly projectDir: string;
  readonly isDeclaredPreserved: (dest: string) => boolean;
};

/**
 * The customised routers whose only local edit is a `## Verbs` row for a verb
 * this bundle now ships (cli#803): with those rows dropped, the file is byte
 * for byte what Specnaut last wrote — its lock SHA proves it, nothing else
 * does. Such a file is planned as unedited, so the bundled verb replaces the
 * local routing instead of the router being skipped as customised. Any other
 * edit — a row for a verb that file already routed among them — keeps the file
 * preserved; a declared preserve is never asked.
 */
export async function supersededVerbEdits(
  ctx: SupersedeContext,
  bundle: Bundle,
  lock: InstalledLock,
  diskShas: ReadonlyMap<string, string>,
): Promise<SupersededEdits> {
  const dests = new Set<string>();
  const notes: string[] = [];
  for (const [dest, file] of Object.entries(bundle)) {
    const lockSha = lock.entries.get(dest)?.sha256;
    if (!editedRouter(file, lockSha, diskShas.get(dest)) || ctx.isDeclaredPreserved(dest)) continue;
    const disk = await ctx.reader.readText(ctx.projectDir, dest);
    const dropped = await restoringDrop(disk, file.content, lockSha!);
    if (dropped === null) continue;
    dests.add(dest);
    notes.push(supersedeNote(dest, dropped));
  }
  return { dests, notes };
}

/** A whole-file router Specnaut wrote, edited on disk since: the only kind a row can restore. */
function editedRouter(file: TemplateFile, lockSha?: string, diskSha?: string): boolean {
  if (lockSha === undefined || diskSha === undefined || diskSha === lockSha) return false;
  if (file.mergeBlock !== undefined || file.symlinkTo !== undefined) return false;
  return file.content.includes("## Verbs");
}

/** The fewest candidate rows whose removal leaves the text hashing to `lockSha`, or null. */
async function restoringDrop(
  disk: string | null,
  bundled: string,
  lockSha: string,
): Promise<ReadonlyArray<string> | null> {
  if (disk === null) return null;
  for (const drop of verbRowDrops(disk, bundled)) {
    if (await sha256Hex(drop.text) !== lockSha) continue;
    // The restored text is what Specnaut last wrote. A verb it already routed
    // was not "started shipping": that row is the project's own, kept.
    const before = routedVerbs(drop.text);
    if (drop.dropped.every((row) => !before.has(rowVerb(row) ?? ""))) return drop.dropped;
  }
  return null;
}

/** What the upgrade says it did, true whether the file is replaced or moves to the plugin. */
function supersedeNote(dest: string, dropped: ReadonlyArray<string>): string {
  const rows = dropped.map((row) => `"${row}"`).join(", ");
  const verbs = [...new Set(dropped.map(rowVerb))].map((v) => `\`${v}\``).join(", ");
  const local = dropped.length === 1 ? "row is" : "rows are";
  return `${dest}: the local ${local} dropped (${rows}); the bundled ${verbs} takes over`;
}
