import {
  type BaseEntry,
  hasCaseTwin,
  REASON,
  SCRIPTS_DIR,
  type ScriptVerdict,
  type TreeEntry,
  type Untrusted,
} from "./script_trust.ts";
import { sameBytes } from "./bytes.ts";
import { inCheckoutScope } from "./checkout_scope.ts";
import { LINK_REASON, type LinkEnd, linkReason } from "./checkout_link.ts";

/**
 * Whether the checkout a session runs in may steer the review of a branch it does not trust. The
 * harness loads its settings, hooks, agents and skills from that checkout when the session starts,
 * and the review then follows its instructions, helper scripts and config: if any of them came
 * from the branch, the branch has already chosen how it is reviewed. So the checkout is trusted
 * only when all three hold:
 *
 * 1. HEAD is the base's tip or one of its ancestors: it holds no commit the tip lacks, the
 *    branch's or any other, since any of them could carry the branch's files;
 * 2. the helper scripts are trusted, as `judgeScripts` in `script_trust.ts` judges them (the
 *    bundle is their second copy);
 * 3. every file in `CHECKOUT_SCOPE` (`checkout_scope.ts`) equals its blob at the base's tip, byte
 *    for byte, and the tip has every one the tree has: no extra file, untracked or ignored ones
 *    included. A link holds only as the tip's own, by where it leads on disk (`checkout_link.ts`).
 *
 * Anything else stops the review, which never falls back to reading the checkout as it is.
 *
 * The harness loaded the checkout as it was when the session started, so the check judges that too:
 * the record a `SessionStart` hook took (`session_record.ts`), by rules 1 and 3. A checkout switched
 * to the base after the session started passes on disk and fails there. Its limit: the record
 * vouches only for a session whose start was the user's own. What the session loaded at start, its
 * hooks, settings or any instruction file, or a version-manager file putting another `specnaut`
 * first on the PATH, can defeat it, since the record is written as the same user. That session is
 * already lost, as {@link restartAdvice} says; the record covers the one whose checkout was
 * switched afterwards.
 */

/** A tree entry as the checkout walk reads it: a file with its identity, a link with its end. */
export type CheckoutEntry = TreeEntry & { readonly id?: string | null; readonly end?: LinkEnd };

/** A file as a session record holds it: the SHA-256 of its bytes, in lowercase hex, for the bytes. */
export type RecordedFile = Omit<Extract<CheckoutEntry, { kind: "file" }>, "bytes"> & {
  readonly sha256: string;
};
export type RecordedEntry = Exclude<CheckoutEntry, { kind: "file" }> | RecordedFile;

/** A walk of one root: its entries, or the folder on the way that stopped it. */
type Walk<E> =
  | { readonly kind: "walked"; readonly entries: readonly E[] }
  | { readonly kind: "blocked"; readonly path: string; readonly why: string };
export type CheckoutWalk = Walk<CheckoutEntry>;
export type RecordedWalk = Walk<RecordedEntry>;

type JudgedFile = Extract<CheckoutEntry | RecordedEntry, { kind: "file" }>;
/** Whether a file holds what the tip has at its path: a blob's bytes, or a link's target. */
export type HoldsTip = (file: JudgedFile, base: BaseEntry) => boolean;

export type CheckoutInput = {
  /** The commits of base..HEAD. */
  readonly headCommits: readonly string[];
  /** The commits of base..<the branch's head>: only to say which reason a commit of HEAD gets. */
  readonly untrustedCommits: readonly string[];
  readonly scripts: ScriptVerdict;
  /** The walk of each `CHECKOUT_SCOPE` root, as the disk holds it. */
  readonly tree: readonly CheckoutWalk[];
  /** The same roots at the base's tip. */
  readonly tip: readonly BaseEntry[];
};

export type CheckoutVerdict = { readonly holds: boolean; readonly reasons: readonly Untrusted[] };

/** The reasons this check adds to {@link REASON}. */
export const CHECKOUT_REASON = {
  headHolds: "HEAD holds this commit of the branch under review",
  headAhead: "HEAD holds this commit the base's tip lacks",
  scripts: "the helper scripts are untrusted",
  ...LINK_REASON,
} as const;

/**
 * What a failed check tells the user: the only way on. The harness loaded this checkout's settings
 * and hooks when the session started, so no change made inside the session can undo what they
 * already did: a new process has to start from a clean copy. `baseTip` is `null` when the base
 * could not be named.
 */
export function restartAdvice(baseTip: string | null): string {
  return "This session is not shown to have started on the base, and it already loaded its " +
    "settings and instructions. A new harness process is required: never switch branches, reset or check " +
    "anything out from this session. Create a clean checkout of the base in a folder outside " +
    `\`.claude/\`: \`git worktree add --detach <dir> ${baseTip ?? "<BASE_TIP>"}\`, ` +
    "then start a new session in that folder.";
}

export function judgeCheckout(input: CheckoutInput): CheckoutVerdict {
  const reasons = [
    ...commitReasons(input),
    ...scriptReasons(input.scripts),
    ...configReasons(input.tree, input.tip, holdsBytes),
  ];
  return { holds: reasons.length === 0, reasons };
}

/** Rule 1: each commit HEAD holds that the tip lacks, named as the branch's or as another. */
export function commitReasons(
  input: Pick<CheckoutInput, "headCommits" | "untrustedCommits">,
): Untrusted[] {
  const outside = new Set(input.untrustedCommits);
  return input.headCommits.map((path) => ({
    path,
    reason: outside.has(path) ? CHECKOUT_REASON.headHolds : CHECKOUT_REASON.headAhead,
  }));
}

function scriptReasons(scripts: ScriptVerdict): readonly Untrusted[] {
  if (scripts.trusted) return [];
  if (scripts.untrusted.length > 0) return scripts.untrusted;
  return [{ path: SCRIPTS_DIR, reason: CHECKOUT_REASON.scripts }];
}

/** A file the walk read holds the tip's blob, or, where links are off, the tip's link's target. */
const holdsBytes: HoldsTip = (file, base) => {
  if (!("bytes" in file)) return false;
  if (base.kind === "blob") return sameBytes(file.bytes, base.bytes);
  return base.kind === "link" && base.target !== undefined &&
    sameBytes(file.bytes, new TextEncoder().encode(base.target));
};

/**
 * Rule 3: each walk that stopped, each tree entry the tip does not match, each tip entry the tree
 * lacks. `holds` compares a file with the tip: by its bytes, or by the digest a record holds.
 */
export function configReasons(
  tree: readonly Walk<CheckoutEntry | RecordedEntry>[],
  tipEntries: readonly BaseEntry[],
  holds: HoldsTip,
): Untrusted[] {
  const out: Untrusted[] = [];
  const entries: (CheckoutEntry | RecordedEntry)[] = [];
  for (const walk of tree) {
    if (walk.kind === "blocked") out.push({ path: walk.path, reason: walk.why });
    else entries.push(...walk.entries.filter((e) => inCheckoutScope(e.path)));
  }
  const tip = tipEntries.filter((e) => inCheckoutScope(e.path));
  const atTip = new Map(tip.map((e) => [e.path, e]));
  const ids = new Set(entries.flatMap((e) => e.kind === "file" && e.id ? [e.id] : []));
  for (const entry of entries) {
    const reason = entryReason(entry, atTip, ids, holds);
    if (reason !== null) out.push({ path: entry.path, reason });
  }
  const inTree = new Set(entries.map((e) => e.path));
  for (const base of tip) {
    if (base.kind === "submodule") out.push({ path: base.path, reason: REASON.submodule });
    else if (!inTree.has(base.path)) out.push({ path: base.path, reason: REASON.missing });
  }
  return out;
}

function entryReason(
  entry: CheckoutEntry | RecordedEntry,
  atTip: ReadonlyMap<string, BaseEntry>,
  ids: ReadonlySet<string>,
  holds: HoldsTip,
): string | null {
  if (entry.kind === "other") return REASON.notRegular;
  if (entry.kind === "unreadable") return `unreadable: ${entry.why}`;
  const base = atTip.get(entry.path);
  if (base === undefined) {
    return hasCaseTwin(entry.path, atTip) ? REASON.caseDiffers : REASON.notOnBase;
  }
  if (entry.kind === "link") return linkReason(entry, base, ids);
  if (entry.links > 1) return REASON.hardLinked;
  return holds(entry, base) ? null : REASON.differs;
}
