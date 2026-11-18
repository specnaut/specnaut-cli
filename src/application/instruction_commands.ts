import {
  COMMAND_REASON,
  type CommandPaths,
  commandPaths,
  isCommandSource,
} from "../domain/command_targets.ts";
import { matching } from "../domain/command_word_paths.ts";
import { onPathTargets } from "../domain/command_search_path.ts";
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
 * A target is judged by its bytes alone; its text is never read for imports or for commands. A
 * program a command names by name alone is tried in each folder any source puts on PATH: a
 * settings file's PATH reaches a skill's hooks too.
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
  const at = { head: await indexAt(walk, walk.base.head), tip: await indexAt(walk, walk.base.tip) };
  for (const path of commandTargets(walk, read, at)) {
    for (const target of heldAs(walk.git.projectPrefix, path, at.head, at.tip)) {
      await visit(walk, target);
    }
  }
}

type Read = { readonly entry: BaseEntry; readonly bytes: Uint8Array; readonly atHead: boolean };
type Found = CommandPaths & { readonly source: Read };

/**
 * Every path the sources `read` name, each path HEAD or the tip holds that a path built around a
 * variable matches, and each program they name in each folder they put on PATH. A source HEAD
 * holds that is not read whole gets the reason. An absolute path is tried from each folder above
 * a project in a subfolder (its depth).
 */
function commandTargets(walk: Walk, read: readonly Read[], at: Indexes) {
  const isFolder = (path: string) => (at.head.get(fold(path)) ?? []).some((p) => p.kind === "tree");
  const depth = walk.git.projectPrefix.split("/").filter(Boolean).length;
  const found: Found[] = read.map((source) => ({
    source,
    ...commandPaths(source.entry.path, source.bytes, isFolder, depth),
  }));
  for (const f of found) if (!f.whole && f.source.atHead) partial(walk, f.source.entry.path);
  const targets = new Set(found.flatMap((f) => f.paths));
  const patterns = [...new Set(found.flatMap((f) => f.patterns))];
  for (const index of [at.head, at.tip]) matching(patterns, index).forEach((p) => targets.add(p));
  onPath(walk, found, at).forEach((p) => targets.add(p));
  return targets;
}

type Indexes = { readonly head: PathIndex; readonly tip: PathIndex };

/**
 * Each program the sources name in each folder any of them puts on PATH, looked up in both
 * commits' listings. When folders a link or a submodule is on the way to make them too many to
 * try, each source that puts a folder there, at either commit, is named: one at the tip alone
 * still brings its folders to HEAD's programs.
 */
function onPath(walk: Walk, found: readonly Found[], at: Indexes): string[] {
  const tried = { whole: true };
  const on = {
    folders: found.flatMap((f) => f.onPath),
    programs: found.flatMap((f) => f.programs),
  };
  const paths = onPathTargets(on, [at.head, at.tip], tried);
  const setters = found.filter((f) => f.onPath.length > 0).map((f) => f.source.entry.path);
  if (!tried.whole) new Set(setters).forEach((path) => partial(walk, path));
  return paths;
}

/** Names `path` as a source whose commands were not all read. */
const partial = (walk: Walk, path: string) =>
  walk.reasons.push({ path, reason: COMMAND_REASON.partial });

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

/** The script check reads its folder as written, as `checkout_scope.ts` does: another spelling is walked. */
const judgedElsewhere = (path: string) => keptAtHead(path) || path.startsWith(`${SCRIPTS_DIR}/`);
