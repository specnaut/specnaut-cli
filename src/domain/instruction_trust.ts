import { sameBytes } from "./bytes.ts";
import { inCheckoutScope } from "./checkout_scope.ts";
import {
  type CheckoutEntry,
  type CheckoutWalk,
  configReasons,
  holdsBytes,
} from "./checkout_trust.ts";
import type { ConfigFile, ConfigVerdict } from "./config_trust.ts";
import { type BaseEntry, type CommitEntry, REASON, type Untrusted } from "./script_trust.ts";
import { refinedReason } from "./trust_reason.ts";
import { headReasons, invisibleReason, invisibleReasons } from "./instruction_head.ts";
import {
  type COMMITTED_INSTRUCTIONS,
  type HeadSplit,
  inComparedRoot,
  splitHead,
} from "./instruction_scope.ts";
import { headLinkReasons } from "./head_link.ts";

export { INSTRUCTION_REASON } from "./instruction_head.ts";
export { COMMITTED_INSTRUCTIONS, INSTRUCTION_SCOPE } from "./instruction_scope.ts";

/**
 * Whether the instruction files a session takes as its rules, and every other surface its harness
 * loads (`INSTRUCTION_SCOPE`: skills, agents, hooks, settings, MCP servers), hold, in the work tree,
 * what the base branch's tip holds. A branch that edits them steers its own review and merge more
 * than any config input does: `AGENTS.md` is read on every turn, an addendum whenever its phase
 * runs, a hook whenever its event fires. One
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

/** One of {@link COMMITTED_INSTRUCTIONS} at the base's tip and the merge base; HEAD's is listed. */
export type CommittedInstruction = {
  readonly path: (typeof COMMITTED_INSTRUCTIONS)[number];
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
  /** HEAD's whole tree, kept by `keptAtHead` (`instruction_scope.ts`): what lands. */
  readonly head: readonly CommitEntry[];
  readonly committed: readonly CommittedInstruction[];
  /** Whether git checks a link out as a link here (`core.symlinks`). */
  readonly symlinks: boolean;
  /**
   * Reasons judged beside the walk, at HEAD: a shipped skill against the copy Specnaut ships
   * (`shipped_skills.ts`), the files above a project in a subfolder (`instruction_parents.ts`).
   * A path the walk already named keeps the walk's reason.
   */
  readonly extra?: readonly Untrusted[];
};

/** One trusted line, or one untrusted line per path, each with its most specific reason. */
export function judgeInstructions(input: InstructionInput): ConfigVerdict[] {
  const head = splitHead(input.head, byPath(input.tip));
  const committed = input.committed.flatMap((c) => committedReason(c, head.overrides.get(c.path)));
  const found = withExtra([...treeReasons(input, head), ...committed], input.extra ?? []);
  if (found.length === 0) return [{ class: INSTRUCTION_CLASS, path: ".", trusted: true }];
  return found.map((u) => ({ class: INSTRUCTION_CLASS, ...u, trusted: false }));
}

function treeReasons(input: InstructionInput, head: HeadSplit): Untrusted[] {
  const holds = holdsBytes(input.symlinks);
  const ctx = {
    tree: treeEntries(input.tree),
    tip: byPath(input.tip),
    old: byPath(input.mergeBase),
  };
  const found = configReasons(input.tree, input.tip, holds, inComparedRoot)
    .map((u) => ({ path: u.path, reason: refined(u, ctx) }));
  const atHead = [
    ...head.reasons,
    ...headLinkReasons(head.entries),
    ...invisibleReasons(head.entries, ctx.tip),
  ];
  const reasons = new Map([...found, ...atHead].map((u) => [u.path, u.reason]));
  const blocked = input.tree.flatMap((w) => w.kind === "blocked" ? [w.path] : []);
  headReasons(reasons, { ...ctx, blocked, head: byPath(head.entries) }, holds);
  return [...reasons].map(([path, reason]) => ({ path, reason }));
}

/** `found`, then each of `extra` on a path `found` does not name. */
function withExtra(found: Untrusted[], extra: readonly Untrusted[]): Untrusted[] {
  const named = new Set(found.map((u) => u.path));
  return [...found, ...extra.filter((u) => !named.has(u.path))];
}

/** HEAD's committed copy against the tip's: none at HEAD is silent, whatever the tree holds. */
function committedReason(c: CommittedInstruction, atHead: ConfigFile | undefined): Untrusted[] {
  const why = (reason: string) => [{ path: c.path, reason }];
  if (atHead === undefined || atHead.kind === "absent") return [];
  if (atHead.kind === "refused") return why(atHead.why);
  if (c.tip.kind === "refused") return why(REASON.baseNotRegular);
  const tip = c.tip.kind === "file" ? c.tip.bytes : undefined;
  if (sameBytes(atHead.bytes, tip)) return [];
  const hidden = invisibleReason(atHead.bytes);
  if (hidden !== null) return why(hidden);
  const mergeBase = c.mergeBase.kind === "file" ? c.mergeBase.bytes : undefined;
  const otherwise = c.tip.kind === "absent" ? REASON.notOnBase : REASON.differs;
  return why(refinedReason(atHead.bytes, { copies: [tip], mergeBase }, otherwise));
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
