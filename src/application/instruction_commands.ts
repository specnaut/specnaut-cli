import { COMMAND_REASON, commandPaths, isCommandSource } from "../domain/command_targets.ts";
import { keptAtHead } from "../domain/instruction_scope.ts";
import { fold, linkOnTheWay, type PathIndex, submoduleOnTheWay } from "../domain/path_index.ts";
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

/**
 * The commands of each judged source HEAD and the tip hold (`sources`), their targets visited. A
 * source HEAD holds whose commands could not all be read is named itself: it is asked about, and
 * the yes covers it, rather than trusted on what was read.
 */
export async function readCommands(
  walk: Walk,
  sources: { readonly head: readonly BaseEntry[]; readonly tip: readonly BaseEntry[] },
): Promise<void> {
  const read = [
    ...await sourcesAt(walk, walk.base.head, sources.head),
    ...await sourcesAt(walk, walk.base.tip, sources.tip),
  ];
  if (read.length === 0) return;
  const head = await indexAt(walk, walk.base.head);
  const tip = await indexAt(walk, walk.base.tip);
  const isFolder = (path: string) => (head.get(fold(path)) ?? []).some((p) => p.kind === "tree");
  for (const path of commandTargets(walk, read, isFolder)) {
    for (const target of heldAs(walk.git.projectPrefix, path, head, tip)) await visit(walk, target);
  }
}

type Read = { readonly entry: BaseEntry; readonly bytes: Uint8Array; readonly atHead: boolean };

/** Every path the sources `read` name; one HEAD holds that is not read whole gets the reason. */
function commandTargets(walk: Walk, read: readonly Read[], isFolder: (p: string) => boolean) {
  const targets = new Set<string>();
  for (const { entry, bytes, atHead } of read) {
    const found = commandPaths(entry.path, bytes, isFolder);
    found.paths.forEach((p) => targets.add(p));
    if (!found.whole && atHead) {
      walk.reasons.push({ path: entry.path, reason: COMMAND_REASON.partial });
    }
  }
  return targets;
}

/** Each command source among `entries`, with the bytes `commit` holds for it. */
async function sourcesAt(walk: Walk, commit: string, entries: readonly BaseEntry[]) {
  const out: Read[] = [];
  for (const entry of entries.filter((e) => isCommandSource(e.path))) {
    const source = await sourceAt(walk, commit, entry);
    if (source !== null) {
      out.push({ entry, bytes: source.bytes, atHead: commit === walk.base.head });
    }
  }
  return out;
}

/**
 * The paths `word` names that HEAD or the tip hold, as each spells them (a disk that folds names
 * runs either), and the word itself when a link HEAD holds, or a submodule HEAD or the tip
 * holds, is on its way (`visit` names a submodule the branch moved): a file or a link, never
 * a folder or a submodule, which no file of its own stands for. A file this class
 * already judges, and a helper script under {@link SCRIPTS_DIR} (judged against the shipped
 * bundle by the script check), are left to them.
 */
function heldAs(prefix: string, word: string, head: PathIndex, tip: PathIndex): string[] {
  const path = canonical(prefix, word);
  if (path === null) return [];
  const held = [...head.get(fold(path)) ?? [], ...tip.get(fold(path)) ?? []]
    .filter((p) => p.kind === "blob" || p.kind === "link").map((p) => p.path);
  const way = [
    linkOnTheWay(path, head),
    submoduleOnTheWay(path, head),
    submoduleOnTheWay(path, tip),
  ];
  if (way.some((p) => p !== undefined)) held.push(path);
  return [...new Set(held)].filter((p) => !judgedElsewhere(p));
}

const judgedElsewhere = (path: string) =>
  keptAtHead(path) || fold(path).startsWith(`${SCRIPTS_DIR}/`);
