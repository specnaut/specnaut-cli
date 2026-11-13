import { sameBytes } from "./bytes.ts";
import { inCheckoutScope, inScopeRoot, type ScopeRoot } from "./checkout_scope.ts";
import {
  type CheckoutEntry,
  type CheckoutWalk,
  configReasons,
  holdsBytes,
} from "./checkout_trust.ts";
import type { ConfigFile, ConfigVerdict } from "./config_trust.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";
import { headReasons } from "./instruction_head.ts";

export { INSTRUCTION_REASON } from "./instruction_head.ts";

/**
 * Whether the instruction files a session takes as its rules hold, in the work tree, what the base
 * branch's tip holds. A branch that edits them steers its own review and merge more than any
 * config input does: `AGENTS.md` is read on every turn, an addendum whenever its phase runs. One
 * class, judged by bytes with the checkout check's walk (`configReasons` in `checkout_trust.ts`):
 * a link that is not the tip's own or leads out of `.specnaut/addenda/`'s compared files, a file
 * the tip lacks, a name that differs in case, a hard link, a tip file the tree lacks: each is one
 * untrusted line, named. What lands is HEAD's commit, not the tree, so each path is judged at HEAD
 * too: a tree that does not hold HEAD's entry is untrusted, so a change committed and then
 * restored in the tree, or hidden from git by `skip-worktree` or `assume-unchanged`, is named.
 *
 * Its limit: the session has already read `AGENTS.md` (and `CLAUDE.md`) before the merge's step 0
 * runs this check, so the verdict cannot undo that read. The control is the stop it causes: an
 * untrusted line makes the merge manual, and a person reads the diff before anything lands.
 */

export const INSTRUCTION_CLASS = "instructions";

/** The instruction files, as roots of the checked files (`checkout_scope.ts` holds them all). */
// deno-fmt-ignore
export const INSTRUCTION_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: ["AGENTS.md", "CLAUDE.md"] },
  { dir: ".claude", deep: false, names: ["CLAUDE.md"] },
  { dir: ".specnaut/addenda", deep: true },
  { dir: "docs", deep: false, names: ["constitution.md"] },
];

/**
 * Overrides a session loads beside the instruction files that a project often keeps as a personal,
 * untracked copy. They are judged from git objects, HEAD's against the tip's, so a copy only the
 * work tree holds stays silent and a committed one counts.
 */
export const COMMITTED_INSTRUCTIONS = ["AGENTS.override.md", "CLAUDE.local.md"] as const;

/** One of {@link COMMITTED_INSTRUCTIONS} at HEAD, the base's tip and the merge base. */
export type CommittedInstruction = {
  readonly path: string;
  readonly head: ConfigFile;
  readonly tip: ConfigFile;
  readonly mergeBase: ConfigFile;
};

export type InstructionInput = {
  /** The walk of each {@link INSTRUCTION_SCOPE} root, as the disk holds it. */
  readonly tree: readonly CheckoutWalk[];
  /** The same roots at the base's tip: what trust is measured against. */
  readonly tip: readonly BaseEntry[];
  /** The same roots at the merge base: read only to say a file is behind the base. */
  readonly mergeBase: readonly BaseEntry[];
  /** The same roots at HEAD: what lands. */
  readonly head: readonly BaseEntry[];
  readonly committed: readonly CommittedInstruction[];
  /** Whether git checks a link out as a link here (`core.symlinks`). */
  readonly symlinks: boolean;
};

/** One trusted line, or one untrusted line per path, each with its most specific reason. */
export function judgeInstructions(input: InstructionInput): ConfigVerdict[] {
  const found = [...treeReasons(input), ...input.committed.flatMap(committedReason)];
  if (found.length === 0) return [{ class: INSTRUCTION_CLASS, path: ".", trusted: true }];
  return found.map((u) => ({ class: INSTRUCTION_CLASS, ...u, trusted: false }));
}

/** A link counts only into a folder this class compares whole: `.specnaut/addenda/`. */
const inComparedRoot = (path: string) =>
  INSTRUCTION_SCOPE.some((r) => r.deep && inScopeRoot(r, path));

function treeReasons(input: InstructionInput): Untrusted[] {
  const holds = holdsBytes(input.symlinks);
  const ctx = {
    tree: treeEntries(input.tree),
    tip: byPath(input.tip),
    old: byPath(input.mergeBase),
  };
  const found = configReasons(input.tree, input.tip, holds, inComparedRoot)
    .map((u) => ({ path: u.path, reason: refined(u, ctx) }));
  const reasons = new Map(found.map((u) => [u.path, u.reason]));
  headReasons(reasons, { tree: ctx.tree, head: byPath(input.head), tip: ctx.tip }, holds);
  return [...reasons].map(([path, reason]) => ({ path, reason }));
}

/** HEAD's committed copy against the tip's: none at HEAD is silent, whatever the tree holds. */
function committedReason(c: CommittedInstruction): Untrusted[] {
  const why = (reason: string) => [{ path: c.path, reason }];
  if (c.head.kind === "absent") return [];
  if (c.head.kind === "refused") return why(c.head.why);
  if (c.tip.kind === "refused") return why(REASON.baseNotRegular);
  const tip = c.tip.kind === "file" ? c.tip.bytes : undefined;
  if (sameBytes(c.head.bytes, tip)) return [];
  const mergeBase = c.mergeBase.kind === "file" ? c.mergeBase.bytes : undefined;
  const otherwise = c.tip.kind === "absent" ? REASON.notOnBase : REASON.differs;
  return why(refinedReason(c.head.bytes, { copies: [tip], mergeBase }, otherwise));
}

type Context = {
  readonly tree: ReadonlyMap<string, CheckoutEntry>;
  readonly tip: ReadonlyMap<string, BaseEntry>;
  readonly old: ReadonlyMap<string, BaseEntry>;
};

/** The checkout check's reason, made the script check's where it says more: CRLF, or behind. */
function refined(u: Untrusted, ctx: Context): string {
  const entry = ctx.tree.get(u.path);
  const mine = entry?.kind === "file" ? entry.bytes : undefined;
  if (mine && (u.reason === REASON.differs || u.reason === REASON.notOnBase)) {
    const copies = [blobBytes(ctx.tip.get(u.path))];
    return refinedReason(mine, { copies, mergeBase: blobBytes(ctx.old.get(u.path)) }, u.reason);
  }
  // A tip file the branch never had: only the base moved since the branch left it.
  if (u.reason === REASON.missing && !ctx.old.has(u.path)) return REASON.behind;
  return u.reason;
}

/** The tree's entries by path, as the tip check takes them: walked roots, checked files. */
function treeEntries(tree: readonly CheckoutWalk[]): ReadonlyMap<string, CheckoutEntry> {
  const out = new Map<string, CheckoutEntry>();
  for (const walk of tree) {
    if (walk.kind !== "walked") continue;
    for (const e of walk.entries) if (inCheckoutScope(e.path)) out.set(e.path, e);
  }
  return out;
}

function blobBytes(entry: BaseEntry | undefined): Uint8Array | undefined {
  return entry?.kind === "blob" ? entry.bytes : undefined;
}

function byPath(entries: readonly BaseEntry[]): ReadonlyMap<string, BaseEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}
