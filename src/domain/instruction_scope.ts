import {
  inScopeRoot,
  INSTRUCTION_NAMES,
  isInstructionFile,
  type ScopeRoot,
} from "./checkout_scope.ts";
import type { ConfigFile } from "./config_trust.ts";
import { type BaseEntry, type CommitEntry, REASON, type Untrusted } from "./script_trust.ts";

/**
 * Which paths the instruction class (`instruction_trust.ts`) judges, and how HEAD's listing is
 * read for them. HEAD is listed whole, never through a pathspec: git matches a pathspec by exact
 * case, so `Docs/constitution.md` or `agents.override.md` would land unlisted, yet a case-blind
 * disk gives either to a session that reads the other name. So scope is decided on the path folded
 * to lower case, and a path in scope only when folded is named.
 */

/**
 * The instruction files, and every other surface a harness loads from the checkout and acts on:
 * skills, agents and their memory, hooks and the settings that name them, slash commands, rules,
 * output styles, MCP servers, Codex's config, Specnaut's own hooks. `.gitattributes` too: it
 * decides how git shows and checks out every other file. Each is a root of the checked files
 * (`checkout_scope.ts` holds them all). `.claude/` is not walked whole: a project may keep worktrees or scratch files there.
 */
// deno-fmt-ignore
export const INSTRUCTION_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: ["AGENTS.md", "CLAUDE.md", ".mcp.json", ".gitattributes"] },
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
 * Whether `path` is an instruction file below the root that no root of the class holds: a harness
 * reads one in whatever folder it finds it (`isInstructionFile` in `checkout_scope.ts`).
 */
export const isNested = (path: string): boolean => isInstructionFile(path) && !inRoots(path);

/** Whether `path` is an instruction path, its letter case aside. */
const foldedInScope = (path: string) => inRoots(path) || isNested(path);

/** Whether `path` is an instruction path as written: a root's own folder and a listed name. */
export function exactlyInScope(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (isNested(path)) return (INSTRUCTION_NAMES as readonly string[]).includes(name);
  return INSTRUCTION_SCOPE.some((r) =>
    inScopeRoot(r, path) && (r.names === undefined || r.names.includes(name))
  );
}

/**
 * The folders holding nested instruction files (`paths`, at HEAD, the tip or the merge base), each
 * once, as roots the work tree's walk reads for the four names alone. A file only the work tree
 * holds, in a folder where no commit holds one, is not walked: the landing refuses a tree with an
 * untracked file, and git keeps out only what the project ignores.
 */
export function nestedRoots(paths: readonly string[]): ScopeRoot[] {
  const dirs = new Set(paths.filter(isNested).map((p) => p.slice(0, p.lastIndexOf("/"))));
  return [...dirs].sort().map((dir) => ({ dir, deep: false, names: [...INSTRUCTION_NAMES] }));
}

/** A link counts only into a folder this class compares whole: `.specnaut/addenda/`. */
export const inComparedRoot = (path: string): boolean =>
  INSTRUCTION_SCOPE.some((r) => r.deep && inScopeRoot(r, path));

/** Whether HEAD's listing keeps `path`, folded: an instruction path, an override, or a folder. */
export function keptAtHead(path: string): boolean {
  const folded = path.toLowerCase();
  return foldedInScope(path) || OVERRIDES.includes(folded) || FOLDERS.includes(folded);
}

/** HEAD's listing as the class reads it. */
export type HeadSplit = {
  /** The instruction paths, letter case aside: judged against the tree and the tip. */
  readonly entries: readonly BaseEntry[];
  /** Each override HEAD holds under its own name. */
  readonly overrides: ReadonlyMap<string, ConfigFile>;
  /** A name in another case the tip does not hold as written, or a folder that is not one. */
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
  const folded = e.path.toLowerCase();
  if (FOLDERS.includes(folded) && e.kind !== "tree") split.reasons.push(why(e.path, NOT_A_FOLDER));
  if (e.kind === "tree") return;
  if (OVERRIDES.includes(folded)) {
    if (isOverride(e.path)) split.overrides.set(e.path, atHead(e));
    else split.reasons.push(why(e.path, REASON.caseDiffers));
  } else if (foldedInScope(e.path)) {
    split.entries.push(e);
    if (!exactlyInScope(e.path) && !tip.has(e.path)) {
      split.reasons.push(why(e.path, REASON.caseDiffers));
    }
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
