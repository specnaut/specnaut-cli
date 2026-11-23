import {
  IMPORT_REASON,
  type ImportedFile,
  type ImportSides,
  importTarget,
} from "../domain/claude_imports.ts";
import {
  type PathIndex,
  pathIndex,
  submoduleMoved,
  throughLinks,
  twinsAtHead,
} from "../domain/path_index.ts";
import { canonical } from "../domain/project_path.ts";
import type { BaseEntry, Untrusted } from "../domain/script_trust.ts";
import type { BaseFile, GitObjectReader } from "./script_trust_ports.ts";

/**
 * One target of the instruction class's walk: a path a judged file names, by an `@` import
 * (`instruction_imports.ts`) or a command (`instruction_commands.ts`), read at HEAD, the base's
 * tip and the merge base, and recorded with its three sides. Both readers share one walk, so a
 * file both name is read once and named once.
 */

export type ImportBase = {
  readonly head: string;
  readonly tip: string;
  readonly mergeBase: string;
};

/** Each imported file's three sides, and the reasons the walk itself found. */
export type ImportRead = {
  readonly files: Map<string, ImportSides>;
  readonly reasons: Untrusted[];
};

export type Source = { readonly path: string; readonly bytes: Uint8Array };
export type Walk = ImportRead & {
  readonly git: GitObjectReader;
  readonly base: ImportBase;
  /** Each commit's whole listing as a lookup (`path_index.ts`), read once, at the first target. */
  readonly indexes: Map<string, Promise<PathIndex>>;
};

export function targetWalk(git: GitObjectReader, base: ImportBase): Walk {
  return { git, base, files: new Map(), reasons: [], indexes: new Map() };
}

/**
 * A judged file the walk starts from, as `commit` holds it: a file by its bytes, a link by its
 * end's (read from the link's folder); `null` for a submodule, or an end that is not a file there.
 */
export async function sourceAt(walk: Walk, commit: string, e: BaseEntry): Promise<Source | null> {
  if (e.kind === "blob") return { path: e.path, bytes: e.bytes };
  if (e.kind !== "link") return null;
  const end = importTarget(e.path, e.target ?? "");
  const read = end === null ? null : await walk.git.readFile(commit, end);
  return end !== null && read?.kind === "blob" ? { path: end, bytes: read.bytes } : null;
}

/** `commit`'s listing as a lookup, read at the first call for it. */
export function indexAt(walk: Walk, commit: string): Promise<PathIndex> {
  let index = walk.indexes.get(commit);
  if (index === undefined) {
    index = walk.git.listPaths(commit).then(pathIndex);
    walk.indexes.set(commit, index);
  }
  return index;
}

/**
 * Reads `written`'s three sides, records them, and returns every path it recorded: the target,
 * then the end of each link it leads through and each of HEAD's names that fold to it (its twins),
 * each visited in turn. A path already recorded is not visited again: two twins name each other.
 * The path is written one way first (`canonical`): `../app/x.md` from the project `app/` is `x.md`.
 */
export async function visit(walk: Walk, written: string): Promise<string[]> {
  const target = canonical(walk.git.projectPrefix, written);
  if (target === null || walk.files.has(target)) return [];
  const { sides, ends, twins, reason } = await targetSides(walk, target);
  walk.files.set(target, sides);
  if (reason !== null) walk.reasons.push({ path: target, reason });
  const recorded = [target];
  for (const next of [...ends, ...twins]) recorded.push(...await visit(walk, next));
  return recorded;
}

/**
 * `target`'s three sides as {@link visit} reads them, recording nothing: the end of each link it
 * leads through, HEAD's names that fold to it, and the reason its way gives (`wayReason`).
 */
export async function targetSides(walk: Walk, target: string) {
  const { sides, ends, outside } = await readSides(walk, target);
  const head = await indexAt(walk, walk.base.head);
  const twins = twinsAtHead(target, head);
  const moved = submoduleMoved(target, head, await indexAt(walk, walk.base.tip));
  return { sides, ends, twins, reason: wayReason(sides, { outside, moved, twin: twins[0] }) };
}

/**
 * What the way to a target says, when its bytes do not: a link HEAD holds that leaves the
 * repository, a submodule on the way at another commit than the tip's, or, for a target HEAD
 * lacks as written, the spelling HEAD holds.
 */
function wayReason(sides: ImportSides, way: { outside?: string; moved?: string; twin?: string }) {
  if (way.outside !== undefined) return `${IMPORT_REASON.linkOnTheWay}: ${way.outside}`;
  if (way.moved !== undefined) return `${IMPORT_REASON.submoduleMoved}: ${way.moved}`;
  if (sides.head === "absent" && way.twin !== undefined) {
    return `${IMPORT_REASON.caseDiffers}: ${way.twin}`;
  }
  return null;
}

/** What reading a target's sides found beside its bytes. */
type Found = { readonly ends: string[]; outside?: string };

/**
 * `path` at HEAD, the tip and the merge base, each through the links that commit holds on its way
 * (`throughLinks`): the bytes a session reads there. Each end other than `path` is returned, to be
 * judged as a file of its own; a link HEAD holds that leaves the repository is `outside`, and that
 * side reads as absent.
 */
async function readSides(walk: Walk, path: string): Promise<Found & { sides: ImportSides }> {
  const found: Found = { ends: [] };
  const at = (commit: string) => sideAt(walk, commit, path, found);
  const { head, tip, mergeBase } = walk.base;
  const sides = { head: await at(head), tip: await at(tip), mergeBase: await at(mergeBase) };
  return { sides, ...found };
}

async function sideAt(walk: Walk, commit: string, path: string, found: Found) {
  const through = throughLinks(walk.git.projectPrefix, path, await indexAt(walk, commit));
  if ("outside" in through) {
    // Nothing in the repository is read there: the reason below names it, at HEAD.
    if (commit === walk.base.head) found.outside ??= through.outside;
    return "absent";
  }
  if (through.end !== path && !found.ends.includes(through.end)) found.ends.push(through.end);
  return imported(await walk.git.readFile(commit, through.end));
}

function imported(file: BaseFile): ImportedFile {
  return file.kind === "blob" ? file.bytes : file.kind;
}
