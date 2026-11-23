import { inScopeRoot, isNestedSurface, NESTED_NAMES, type ScopeRoot } from "./checkout_scope.ts";
import type { ConfigFile } from "./config_trust.ts";
import { asciiSkeleton, holdsNonAscii, NON_ASCII_REASON } from "./non_ascii_path.ts";
import { type BaseEntry, type CommitEntry, REASON, type Untrusted } from "./script_trust.ts";
import { APPROVALS_FILE } from "./skill_approvals.ts";
import { holdsShortName, shortNameReasons, win32Fold, win32Reason } from "./win32_path.ts";

/**
 * Which paths the instruction class (`instruction_trust.ts`) judges, and how HEAD's listing is
 * read for them. HEAD is listed whole, never through a pathspec: git matches a pathspec by exact
 * case, so `Docs/constitution.md` or `agents.override.md` would land unlisted, yet a case-blind
 * disk gives either to a session that reads the other name. So scope is decided on the path folded
 * to lower case, and a path in scope only when folded is named. A disk may fold beyond ASCII too:
 * a path holding a code point outside it is kept when its ASCII skeleton is in scope
 * (`non_ascii_path.ts`), and named unless the tip holds it as written, never matched to another.
 * Win32's spellings are folded too, and a name shaped like a short name kept (`win32_path.ts`).
 */

/**
 * The instruction files, and every other surface a harness loads from the checkout and acts on:
 * skills, agents and their memory, hooks and the settings that name them, slash commands, rules,
 * output styles, MCP servers, Codex's config, Specnaut's own hooks, and the skill approvals (a
 * branch that writes one is named). `.gitattributes` and `.lfsconfig` too: they decide how git
 * shows and checks out every other file. Each is a root of the checked files (`checkout_scope.ts`
 * holds them all). `.claude/` is not walked whole: a project may keep worktrees or scratch files
 * there.
 */
// deno-fmt-ignore
export const INSTRUCTION_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: ["AGENTS.md", "CLAUDE.md", ".mcp.json", ".gitattributes", ".lfsconfig"] },
  { dir: ".claude", deep: false, names: ["CLAUDE.md", "settings.json"] },
  { dir: ".claude/skills", deep: true },
  { dir: ".claude/agents", deep: true },
  { dir: ".claude/hooks", deep: true },
  { dir: ".claude/commands", deep: true },
  { dir: ".claude/rules", deep: true },
  { dir: ".claude/output-styles", deep: true },
  { dir: ".codex", deep: true },
  { dir: ".agents", deep: true },
  { dir: ".specnaut/hooks", deep: true },
  { dir: ".specnaut/addenda", deep: true },
  { dir: ".specnaut", deep: false, names: [APPROVALS_FILE.slice(".specnaut/".length)] },
  { dir: "docs", deep: false, names: ["constitution.md"] },
];

/**
 * Overrides a session loads beside the instruction files that a project often keeps as a personal,
 * untracked copy. They are judged from git objects, HEAD's against the tip's, so a copy only the
 * work tree holds stays silent and a committed one counts.
 */
export const COMMITTED_INSTRUCTIONS = [
  "AGENTS.override.md",
  "CLAUDE.local.md",
  ".claude/settings.local.json",
] as const;

/** The reason a folder holding instruction files gets when HEAD has something else there. */
export const NOT_A_FOLDER = "not a folder at HEAD";

/** Each folder on the way to a root's files: HEAD must hold a folder there, not a link or a file. */
const FOLDERS: readonly string[] = [
  ...new Set(INSTRUCTION_SCOPE.flatMap((r) => {
    const parts = r.dir === "." ? [] : r.dir.split("/");
    const ways = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    return r.deep ? ways.slice(0, -1) : ways; // a deep root is itself in scope: judged as an entry
  })),
].map((f) => f.toLowerCase());

const OVERRIDES = COMMITTED_INSTRUCTIONS.map((p) => p.toLowerCase());

/** Whether a root of {@link INSTRUCTION_SCOPE} holds `path`, its letter case aside. */
const inRoots = (path: string) => INSTRUCTION_SCOPE.some((r) => inScopeRoot(r, path.toLowerCase()));

/**
 * Whether `path` is a nested name below the root that no root of the class holds: a harness, or
 * git, reads one in whatever folder it finds it (`isNestedSurface` in `checkout_scope.ts`).
 */
export const isNested = (path: string): boolean => isNestedSurface(path) && !inRoots(path);

/** Whether `path` is listed from a commit's whole tree, outside the roots: nested, or a short name. */
export const outsideRoots = (path: string): boolean =>
  isNested(path) || (holdsShortName(path) && !inRoots(path));

/** Whether `path` is an instruction path, its letter case aside. */
const foldedInScope = (path: string) => inRoots(path) || isNested(path);

/** Whether `path` is an instruction path as written: a root's own folder and a listed name. */
export function exactlyInScope(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (isNested(path)) return NESTED_NAMES.includes(name);
  return INSTRUCTION_SCOPE.some((r) =>
    inScopeRoot(r, path) && (r.names === undefined || r.names.includes(name))
  );
}

/**
 * The folders holding nested files (`paths`, at HEAD, the tip or the merge base), each once, as
 * roots the work tree's walk reads for {@link NESTED_NAMES} alone. A file only the work tree
 * holds, in a folder where no commit holds one, is not walked: the landing refuses a tree with an
 * untracked file, and git keeps out only what the project ignores.
 */
export function nestedRoots(paths: readonly string[]): ScopeRoot[] {
  const dirs = new Set(paths.filter(isNested).map((p) => p.slice(0, p.lastIndexOf("/"))));
  return [...dirs].sort().map((dir) => ({ dir, deep: false, names: NESTED_NAMES }));
}

/** A link counts only into a folder this class compares whole: `.specnaut/addenda/`. */
export const inComparedRoot = (path: string): boolean =>
  INSTRUCTION_SCOPE.some((r) => r.deep && inScopeRoot(r, path));

/**
 * Whether HEAD's listing keeps `path`, folded: an instruction path, an override, or a folder; one
 * holding a code point outside ASCII also when its ASCII skeleton is one of them. Every path of
 * HEAD's tree comes through here, so an ASCII one is never normalised: its skeleton is its fold.
 */
export function keptAtHead(path: string): boolean {
  return keptFolded(path) || (holdsNonAscii(path) && keptFolded(asciiSkeleton(path)));
}

function keptFolded(path: string): boolean {
  const folded = win32Fold(path);
  return foldedInScope(folded) || OVERRIDES.includes(folded) || FOLDERS.includes(folded) ||
    holdsShortName(path);
}

/** HEAD's listing as the class reads it. */
export type HeadSplit = {
  /** The instruction paths, letter case aside: judged against the tree and the tip. */
  readonly entries: readonly BaseEntry[];
  /** Each override HEAD holds under its own name. */
  readonly overrides: ReadonlyMap<string, ConfigFile>;
  /**
   * A name in another case, or holding a code point outside ASCII, that the tip does not hold as
   * written, or a folder that is not one.
   */
  readonly reasons: readonly Untrusted[];
};

/** Splits HEAD's kept listing ({@link keptAtHead}); `tip` holds the instruction roots at the tip. */
export function splitHead(
  listing: readonly CommitEntry[],
  tip: ReadonlyMap<string, BaseEntry>,
): HeadSplit {
  const split: Split = { entries: [], overrides: new Map(), reasons: [] };
  for (const e of listing) place(e, tip, split);
  return split;
}

type Split = { entries: BaseEntry[]; overrides: Map<string, ConfigFile>; reasons: Untrusted[] };

/** Where one listed entry goes: a folder that is not one, an override, an instruction path. */
function place(e: CommitEntry, tip: ReadonlyMap<string, BaseEntry>, split: Split): void {
  if (holdsNonAscii(e.path)) return placeNonAscii(e, tip, split);
  const folded = win32Fold(e.path);
  if (FOLDERS.includes(folded) && e.kind !== "tree") split.reasons.push(why(e.path, NOT_A_FOLDER));
  if (e.kind === "tree") return;
  if (OVERRIDES.includes(folded)) {
    if (isOverride(e.path)) split.overrides.set(e.path, atHead(e));
    else split.reasons.push(why(e.path, spelled(e.path)));
  } else if (foldedInScope(folded)) {
    split.entries.push(e);
    const asWritten = exactlyInScope(e.path) && !holdsShortName(e.path);
    if (!asWritten && !tip.has(e.path)) split.reasons.push(why(e.path, spelled(e.path)));
  } else if (holdsShortName(e.path)) split.reasons.push(...shortNameReasons(e, tip.get(e.path)));
}

/** Why a name in scope only once folded is named: Win32's spelling first, else its letter case. */
const spelled = (path: string) => win32Reason(path) ?? REASON.caseDiffers;

/**
 * A name holding a code point outside ASCII is judged as written, never as the name it may be. One
 * that may stand for a root's folder and is not a folder is named so whatever the tip holds, as
 * its ASCII twin in another letter case is.
 */
function placeNonAscii(e: CommitEntry, tip: ReadonlyMap<string, BaseEntry>, split: Split): void {
  if (e.kind === "tree") return;
  if (FOLDERS.includes(asciiSkeleton(e.path))) {
    split.reasons.push(why(e.path, NOT_A_FOLDER));
  } else {
    split.entries.push(e);
    if (!tip.has(e.path)) split.reasons.push(why(e.path, NON_ASCII_REASON));
  }
}

const isOverride = (path: string) => COMMITTED_INSTRUCTIONS.some((p) => p === path);

const why = (path: string, reason: string): Untrusted => ({ path, reason });

/** An override as HEAD commits it: a blob's bytes, anything else refused. */
function atHead(e: BaseEntry): ConfigFile {
  return e.kind === "blob"
    ? { kind: "file", bytes: e.bytes }
    : { kind: "refused", why: REASON.notRegular };
}
