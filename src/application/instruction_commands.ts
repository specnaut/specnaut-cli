import { commandEntries, entryPaths, isCommandSource } from "../domain/command_targets.ts";
import { keptAtHead } from "../domain/instruction_scope.ts";
import { fold, linkOnTheWay, type PathIndex } from "../domain/path_index.ts";
import { canonical } from "../domain/project_path.ts";
import { type BaseEntry, SCRIPTS_DIR } from "../domain/script_trust.ts";
import { indexAt, sourceAt, visit, type Walk } from "./head_targets.ts";

/**
 * The files the judged configs' commands run (`command_targets.ts`), resolved and judged as HEAD
 * commits them against the base's tip, through the walk the imports take (`head_targets.ts`):
 * each word that names a file HEAD or the tip holds, in any letter case, or a path through a link
 * HEAD holds. Resolved and judged, never refused: a target the branch leaves alone stays silent,
 * so only a changed one is named, where refusing would name an unchanged hook on every merge.
 * A target is judged by its bytes alone; its text is never read for imports or for commands.
 */

/** The commands of each judged source HEAD and the tip hold (`sources`), their targets visited. */
export async function readCommands(
  walk: Walk,
  sources: { readonly head: readonly BaseEntry[]; readonly tip: readonly BaseEntry[] },
): Promise<void> {
  const entries = [
    ...await entriesAt(walk, walk.base.head, sources.head),
    ...await entriesAt(walk, walk.base.tip, sources.tip),
  ];
  if (entries.length === 0) return;
  const head = await indexAt(walk, walk.base.head);
  const tip = await indexAt(walk, walk.base.tip);
  const isFolder = (path: string) => (head.get(fold(path)) ?? []).some((p) => p.kind === "tree");
  const targets = new Set(entries.flatMap((words) => entryPaths(words, isFolder)));
  for (const path of targets) {
    for (const target of heldAs(walk.git.projectPrefix, path, head, tip)) await visit(walk, target);
  }
}

/** The word groups of each command source among `entries`, read at `commit`. */
async function entriesAt(walk: Walk, commit: string, entries: readonly BaseEntry[]) {
  const out: string[][] = [];
  for (const e of entries.filter((e) => isCommandSource(e.path))) {
    const source = await sourceAt(walk, commit, e);
    if (source !== null) out.push(...commandEntries(e.path, source.bytes));
  }
  return out;
}

/**
 * The paths `word` names that HEAD or the tip hold, as each spells them (a disk that folds names
 * runs either), and the word itself when a link HEAD holds is on its way: a file or a link, never
 * a folder or a submodule, which no file of its own stands for. A file this class
 * already judges, and a helper script under {@link SCRIPTS_DIR} (judged against the shipped
 * bundle by the script check), are left to them.
 */
function heldAs(prefix: string, word: string, head: PathIndex, tip: PathIndex): string[] {
  const path = canonical(prefix, word);
  if (path === null) return [];
  const held = [...head.get(fold(path)) ?? [], ...tip.get(fold(path)) ?? []]
    .filter((p) => p.kind === "blob" || p.kind === "link").map((p) => p.path);
  if (linkOnTheWay(path, head) !== undefined) held.push(path);
  return [...new Set(held)].filter((p) => !judgedElsewhere(p));
}

const judgedElsewhere = (path: string) =>
  keptAtHead(path) || fold(path).startsWith(`${SCRIPTS_DIR}/`);
