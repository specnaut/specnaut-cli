/**
 * Whether the helper scripts a review or a merge runs from the work tree may be run: the review
 * checks them against a copy the branch under review does not carry. One bit for the whole folder,
 * the granularity the phases act on.
 *
 * A file is trusted only when it is a regular file, linked once, whose bytes equal its blob at the
 * base branch's tip, or the copy this binary bundles, mapped through the lock read at that tip
 * (the lock in the work tree is the branch's own). Bytes are compared raw: no line-ending
 * normalisation, no filter. Anything else — a link, a file the base does not have, a base file
 * the tree lacks while the bundle still ships it (one it no longer ships is what an upgrade
 * removes), a submodule, a name that differs only in case — makes the whole folder untrusted, each
 * with its reason.
 *
 * Its limit: it guards against mistakes (a branch editing the helpers that grade or land it, a
 * stale or dogfooding copy), not deliberate rewrites: phase docs and harness settings are out of
 * its reach (`checkout_trust.ts` checks those), and a review already runs the branch's own tests.
 */

import { sameBytes } from "./bytes.ts";
import { REASON, refinedReason } from "./trust_reason.ts";

/** The folder checked, relative to the project's root. */
export const SCRIPTS_DIR = ".specnaut/scripts";

/** What the walk of the work tree found at one path under {@link SCRIPTS_DIR}. */
export type TreeEntry =
  | {
    readonly kind: "file";
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly links: number;
  }
  | { readonly kind: "link"; readonly path: string; readonly target?: string }
  | { readonly kind: "other"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/** The walk: its entries, or the folder on the way that stopped it (a link, not a folder). */
export type TreeWalk =
  | { readonly kind: "walked"; readonly entries: readonly TreeEntry[] }
  | { readonly kind: "blocked"; readonly path: string; readonly why: string };

/** One entry of a commit's tree under {@link SCRIPTS_DIR}, as `git ls-tree -r` lists it. */
export type BaseEntry =
  | { readonly kind: "blob"; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: "link"; readonly path: string; readonly target?: string }
  | { readonly kind: "submodule"; readonly path: string };

/** One entry of a commit's whole tree, as `git ls-tree -r -t` lists it: a folder included. */
export type CommitEntry = BaseEntry | { readonly kind: "tree"; readonly path: string };

/**
 * The bundled copy, mapped through the lock at the base's tip. With no lock there, only the base
 * rule applies: a first install trusts what the base already has.
 */
export type BundleRule =
  | { readonly kind: "mapped"; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly kind: "no_lock_at_base" }
  | { readonly kind: "unavailable"; readonly why: string };

export type TrustInput = {
  readonly tree: TreeWalk;
  /** The base branch's tip: what trust is measured against. */
  readonly tip: readonly BaseEntry[];
  /** The merge base: read only to say a file is behind the base rather than edited. */
  readonly mergeBase: readonly BaseEntry[];
  readonly bundle: BundleRule;
  /** The base's name when its local branch holds commits origin's copy lacks, else `null`. */
  readonly localBaseAhead?: string | null;
};

export type Untrusted = { readonly path: string; readonly reason: string };
export type ScriptVerdict = { readonly trusted: boolean; readonly untrusted: readonly Untrusted[] };

/** The reasons live in `trust_reason.ts`; the checks that take their types from here read them here. */
export { REASON } from "./trust_reason.ts";

/** The lock the bundle rule reads at the base. */
export const BASE_LOCK = ".specnaut/installed.lock";

export function judgeScripts(input: TrustInput): ScriptVerdict {
  const untrusted = [...outsideReasons(input)];
  if (input.tree.kind === "blocked") {
    untrusted.push({ path: input.tree.path, reason: input.tree.why });
    return { trusted: false, untrusted };
  }
  untrusted.push(...treeReasons(input.tree.entries, input));
  return { trusted: untrusted.length === 0, untrusted };
}

/** The reasons that name no script: the base's local copy, the lock read at the base. */
function outsideReasons(input: TrustInput): Untrusted[] {
  const out: Untrusted[] = [];
  const ahead = input.localBaseAhead ?? null;
  if (ahead !== null) {
    out.push({ path: `refs/heads/${ahead}`, reason: `local ${ahead} ahead of origin` });
  }
  if (input.bundle.kind === "unavailable") {
    out.push({ path: BASE_LOCK, reason: `at base: ${input.bundle.why}` });
  }
  return out;
}

/** Each tree entry that matches no copy, then each base entry the tree does not answer for. */
function treeReasons(entries: readonly TreeEntry[], input: TrustInput): Untrusted[] {
  const out: Untrusted[] = [];
  const ctx = { tip: byPath(input.tip), mergeBase: byPath(input.mergeBase), bundle: input.bundle };
  for (const entry of entries) {
    const reason = entryReason(entry, ctx);
    if (reason !== null) out.push({ path: entry.path, reason });
  }
  const inTree = new Set(entries.map((e) => e.path));
  for (const base of input.tip) {
    const reason = baseReason(base, inTree, input.bundle);
    if (reason !== null) out.push({ path: base.path, reason });
  }
  return out;
}

type Context = {
  readonly tip: ReadonlyMap<string, BaseEntry>;
  readonly mergeBase: ReadonlyMap<string, BaseEntry>;
  readonly bundle: BundleRule;
};

function entryReason(entry: TreeEntry, ctx: Context): string | null {
  if (entry.kind === "link") return REASON.link;
  if (entry.kind === "other") return REASON.notRegular;
  if (entry.kind === "unreadable") return `unreadable: ${entry.why}`;
  if (entry.links > 1) return REASON.hardLinked;
  const atTip = ctx.tip.get(entry.path);
  const bundled = ctx.bundle.kind === "mapped" ? ctx.bundle.files.get(entry.path) : undefined;
  const tipBytes = atTip?.kind === "blob" ? atTip.bytes : undefined;
  if (sameBytes(entry.bytes, tipBytes) || sameBytes(entry.bytes, bundled)) return null;
  return mismatchReason(entry.path, entry.bytes, { atTip, tipBytes, bundled }, ctx);
}

/** Why a regular file matched neither copy: the most specific reason that holds. */
function mismatchReason(
  path: string,
  bytes: Uint8Array,
  copies: { atTip?: BaseEntry; tipBytes?: Uint8Array; bundled?: Uint8Array },
  ctx: Context,
): string {
  const { atTip, tipBytes, bundled } = copies;
  if (atTip !== undefined && atTip.kind !== "blob") return REASON.baseNotRegular;
  const old = ctx.mergeBase.get(path);
  const mergeBase = old?.kind === "blob" ? old.bytes : undefined;
  if (atTip === undefined && bundled === undefined) {
    // The tip deleted or renamed a file the branch never touched: the rebase settles it.
    const added = ctx.bundle.kind === "no_lock_at_base" ? REASON.firstInstall : REASON.notOnBase;
    const otherwise = hasCaseTwin(path, ctx.tip) ? REASON.caseDiffers : added;
    return refinedReason(bytes, { copies: [], mergeBase }, otherwise);
  }
  return refinedReason(bytes, { copies: [tipBytes, bundled], mergeBase }, REASON.differs);
}

/**
 * A base entry the tree does not answer for. A file the bundle no longer ships may be gone: that is
 * what an upgrade writes. A submodule is never trusted, whatever the tree holds there.
 */
function baseReason(base: BaseEntry, inTree: ReadonlySet<string>, bundle: BundleRule) {
  if (base.kind === "submodule") return REASON.submodule;
  if (inTree.has(base.path)) return null;
  if (bundle.kind === "mapped" && !bundle.files.has(base.path)) return null;
  return REASON.missing;
}

function byPath(entries: readonly BaseEntry[]): ReadonlyMap<string, BaseEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}

/** Another path in `entries` that is `path` but for letter case: one file on a case-blind disk. */
export function hasCaseTwin(path: string, entries: ReadonlyMap<string, BaseEntry>): boolean {
  const folded = path.toLowerCase();
  return [...entries.keys()].some((other) => other !== path && other.toLowerCase() === folded);
}
