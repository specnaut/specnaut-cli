/**
 * A router's `## Verbs` table is where a project routes a verb of its own —
 * a row sending `kanban` to a project-level skill, say. When a later bundle
 * ships that verb itself, the project's row is no longer a customisation
 * worth keeping: it is the verb, routed elsewhere (cli#803). These functions
 * find the rows such a supersede may drop; whether dropping them leaves the
 * file Specnaut last wrote is the caller's question (its lock SHA).
 *
 * Content-driven, never a list of verbs: any verb the bundle starts routing
 * is covered, and a file with no `## Verbs` section has no candidate.
 */

/** Past this many candidate rows no subset is tried: 2^10 drops at most. */
export const MAX_CANDIDATE_ROWS = 10;

/** One way to drop rows: the text left, and the rows dropped, as written. */
export type VerbRowDrop = { readonly text: string; readonly dropped: ReadonlyArray<string> };

/** The verb a table row routes: its first cell's first word, backticks dropped. */
export function rowVerb(line: string): string | null {
  const cell = /^\|([^|]*)\|/.exec(line.trim())?.[1];
  if (cell === undefined) return null;
  const word = cell.replaceAll("`", "").trim().split(/\s+/)[0];
  return word === "" || /^:?-+:?$/.test(word) ? null : word;
}

/** Index of each table row in `lines`' `## Verbs` section, up to the next `## ` heading. */
function verbsRows(lines: ReadonlyArray<string>): number[] {
  const start = lines.findIndex((l) => l.trimEnd() === "## Verbs");
  if (start === -1) return [];
  const rows: number[] = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## "); i++) {
    if (lines[i].trimStart().startsWith("|")) rows.push(i);
  }
  return rows;
}

/** Every verb the `## Verbs` rows of `text` route. */
export function routedVerbs(text: string): Set<string> {
  const lines = text.split("\n");
  return new Set(verbsRows(lines).map((i) => rowVerb(lines[i])).filter((v) => v !== null));
}

/**
 * The `## Verbs` rows of `disk` a supersede may drop: each routes a verb the
 * `bundled` table also routes, in a line no bundled row is. A project's own
 * row for a newly shipped verb is one; so is an older bundle's wording of a
 * row this bundle rewrote, which is why the caller tries subsets. A row for a
 * verb the project already had routed (`review --deep`, a second `plan`) is one
 * too: the caller keeps only a drop whose verbs the restored text never routed.
 */
export function candidateRows(disk: string, bundled: string): number[] {
  const lines = bundled.split("\n");
  const shipped = verbsRows(lines).map((i) => lines[i].trimEnd());
  const verbs = routedVerbs(bundled);
  const diskLines = disk.split("\n");
  return verbsRows(diskLines).filter((i) => {
    const verb = rowVerb(diskLines[i]);
    return verb !== null && verbs.has(verb) && !shipped.includes(diskLines[i].trimEnd());
  });
}

/**
 * Every non-empty set of candidate rows dropped from `disk`, fewest first:
 * the smallest drop that restores the file is the one to report. None when
 * there is no candidate, or more than `MAX_CANDIDATE_ROWS`.
 */
export function* verbRowDrops(disk: string, bundled: string): Generator<VerbRowDrop> {
  const rows = candidateRows(disk, bundled);
  if (rows.length === 0 || rows.length > MAX_CANDIDATE_ROWS) return;
  const lines = disk.split("\n");
  const masks = Array.from({ length: (1 << rows.length) - 1 }, (_, i) => i + 1);
  const size = (m: number) => rows.filter((_, b) => (m >> b) & 1).length;
  for (const mask of masks.sort((a, b) => size(a) - size(b))) {
    const drop = new Set(rows.filter((_, b) => (mask >> b) & 1));
    yield {
      text: lines.filter((_, i) => !drop.has(i)).join("\n"),
      dropped: [...drop].map((i) => lines[i].trimEnd()),
    };
  }
}
