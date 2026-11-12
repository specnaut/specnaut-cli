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
import { inCheckoutScope, inDeepRoot } from "./checkout_scope.ts";

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
 *    included. A link holds only as the tip's own, by where it leads on disk (`linkReason`).
 *
 * Anything else stops the review, which never falls back to reading the checkout as it is.
 */

/**
 * Where a link leads, as the walk resolved it on disk: a path relative to the project's real root
 * with the file's identity (`dev:ino`, `null` where the platform has none), or why it leads nowhere
 * the check can follow.
 */
export type LinkEnd =
  | { readonly kind: "inside"; readonly path: string; readonly id: string | null }
  | { readonly kind: "outside" }
  | { readonly kind: "unresolved"; readonly why: string };

/** A tree entry as the checkout walk reads it: a file with its identity, a link with its end. */
export type CheckoutEntry = TreeEntry & { readonly id?: string | null; readonly end?: LinkEnd };

export type CheckoutWalk =
  | { readonly kind: "walked"; readonly entries: readonly CheckoutEntry[] }
  | { readonly kind: "blocked"; readonly path: string; readonly why: string };

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
  linkLeaves: "a link out of the checked files",
  linkForm: "a link target with a backslash or a drive",
  linkUnresolved: "a link that leads nowhere",
} as const;

/**
 * What a failed check tells the user: the only way on. The harness loaded this checkout's settings
 * and hooks when the session started, so no change made inside the session can undo what they
 * already did: a new process has to start from a clean copy. `baseTip` is `null` when the base
 * could not be named.
 */
export function restartAdvice(baseTip: string | null): string {
  return "This checkout is not the base, and this session already loaded its settings and " +
    "instructions. A new harness process is required: never switch branches, reset or check " +
    "anything out from this session. Create a clean checkout of the base in a folder outside " +
    `\`.claude/\`: \`git worktree add --detach <dir> ${baseTip ?? "<BASE_TIP>"}\`, ` +
    "then start a new session in that folder.";
}

export function judgeCheckout(input: CheckoutInput): CheckoutVerdict {
  const reasons = [
    ...commitReasons(input),
    ...scriptReasons(input.scripts),
    ...configReasons(input),
  ];
  return { holds: reasons.length === 0, reasons };
}

function commitReasons(input: CheckoutInput): Untrusted[] {
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

/** Each walk that stopped, each tree entry the tip does not match, each tip entry the tree lacks. */
function configReasons(input: CheckoutInput): Untrusted[] {
  const out: Untrusted[] = [];
  const entries: CheckoutEntry[] = [];
  for (const walk of input.tree) {
    if (walk.kind === "blocked") out.push({ path: walk.path, reason: walk.why });
    else entries.push(...walk.entries.filter((e) => inCheckoutScope(e.path)));
  }
  const tip = input.tip.filter((e) => inCheckoutScope(e.path));
  const atTip = new Map(tip.map((e) => [e.path, e]));
  const ids = new Set(entries.flatMap((e) => e.kind === "file" && e.id ? [e.id] : []));
  for (const entry of entries) {
    const reason = entryReason(entry, atTip, ids);
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
  entry: CheckoutEntry,
  atTip: ReadonlyMap<string, BaseEntry>,
  ids: ReadonlySet<string>,
): string | null {
  if (entry.kind === "other") return REASON.notRegular;
  if (entry.kind === "unreadable") return `unreadable: ${entry.why}`;
  const base = atTip.get(entry.path);
  if (base === undefined) {
    return hasCaseTwin(entry.path, atTip) ? REASON.caseDiffers : REASON.notOnBase;
  }
  if (entry.kind === "link") return linkReason(entry, base, ids);
  if (entry.links > 1) return REASON.hardLinked;
  if (base.kind === "blob" && sameBytes(entry.bytes, base.bytes)) return null;
  // A link checked out where links are off is a file holding the link's target: the tip's blob.
  if (base.kind === "link" && base.target !== undefined) {
    if (sameBytes(entry.bytes, new TextEncoder().encode(base.target))) return null;
  }
  return REASON.differs;
}

/**
 * A link holds only as the tip's own link, written with forward slashes and no drive, and only when
 * it leads, on disk, to a file this check compared (the same `dev:ino`) or into a root it walks
 * whole. A link into the project's other files, a subfolder no root walks, or out of the project
 * leads where the check cannot vouch for.
 */
function linkReason(
  entry: CheckoutEntry & { kind: "link" },
  base: BaseEntry,
  ids: ReadonlySet<string>,
): string | null {
  if (base.kind !== "link" || entry.target === undefined || entry.target !== base.target) {
    return REASON.differs;
  }
  if (/\\|^[A-Za-z]:/.test(entry.target)) return CHECKOUT_REASON.linkForm;
  const end = entry.end;
  if (end === undefined || end.kind === "outside") return CHECKOUT_REASON.linkLeaves;
  if (end.kind === "unresolved") return `${CHECKOUT_REASON.linkUnresolved}: ${end.why}`;
  if (end.id !== null && ids.has(end.id)) return null;
  return inDeepRoot(end.path) ? null : CHECKOUT_REASON.linkLeaves;
}
