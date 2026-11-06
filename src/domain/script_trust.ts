/**
 * Whether the helper scripts a review or a merge runs from the work tree may be run: the review
 * checks them against a copy the branch under review does not carry. One bit for the whole folder,
 * the granularity the phases act on.
 *
 * A file is trusted only when it is a regular file, linked once, whose bytes equal its blob at the
 * base branch's tip, or the copy this binary bundles, mapped through the lock read at that tip
 * (the lock in the work tree is the branch's own). Bytes are compared raw: no line-ending
 * normalisation, no filter. Anything else — a link, a file the base does not have, a base file
 * the tree lacks, a submodule, a name that differs only in case — makes the whole folder
 * untrusted, each with its reason.
 *
 * Its limit: it guards against mistakes, not deliberate rewrites. It catches an agent's branch
 * that edits the helpers that grade or land it, a stale copy, a dogfooding copy. A branch that also
 * edits the phase docs calling it, or the harness's own settings, is out of its reach, and a review
 * already runs the branch's own tests.
 */

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
  | { readonly kind: "link"; readonly path: string }
  | { readonly kind: "other"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/** The walk: its entries, or the folder on the way that stopped it (a link, not a folder). */
export type TreeWalk =
  | { readonly kind: "walked"; readonly entries: readonly TreeEntry[] }
  | { readonly kind: "blocked"; readonly path: string; readonly why: string };

/** One entry of a commit's tree under {@link SCRIPTS_DIR}, as `git ls-tree -r` lists it. */
export type BaseEntry =
  | { readonly kind: "blob"; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: "link"; readonly path: string }
  | { readonly kind: "submodule"; readonly path: string };

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
};

export type Untrusted = { readonly path: string; readonly reason: string };
export type ScriptVerdict = { readonly trusted: boolean; readonly untrusted: readonly Untrusted[] };

/** The reasons, worded once: the phases quote them in a `NOT RUN` line. */
export const REASON = {
  link: "a link",
  notRegular: "not a regular file",
  hardLinked: "hard-linked",
  notOnBase: "not on base",
  firstInstall: "first install: no base copy",
  missing: "on base, missing from the tree",
  submodule: "a submodule on base",
  caseDiffers: "name differs in case from base",
  lineEndings: "line endings differ",
  behind: "behind base: rebase",
  differs: "differs from base",
  baseNotRegular: "not a regular file on base",
} as const;

/** The lock at the base, as the bundle rule reads it. */
export const BASE_LOCK = ".specnaut/installed.lock";

export function judgeScripts(input: TrustInput): ScriptVerdict {
  const untrusted: Untrusted[] = [];
  if (input.bundle.kind === "unavailable") {
    untrusted.push({ path: BASE_LOCK, reason: `at base: ${input.bundle.why}` });
  }
  if (input.tree.kind === "blocked") {
    untrusted.push({ path: input.tree.path, reason: input.tree.why });
    return { trusted: false, untrusted };
  }
  const tip = byPath(input.tip);
  const ctx = { tip, mergeBase: byPath(input.mergeBase), bundle: input.bundle };
  for (const entry of input.tree.entries) {
    const reason = entryReason(entry, ctx);
    if (reason !== null) untrusted.push({ path: entry.path, reason });
  }
  const inTree = new Set(input.tree.entries.map((e) => e.path));
  for (const base of input.tip) {
    const reason = baseReason(base, inTree, input.bundle);
    if (reason !== null) untrusted.push({ path: base.path, reason });
  }
  return { trusted: untrusted.length === 0, untrusted };
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
  if (atTip === undefined && bundled === undefined) {
    if (hasCaseTwin(path, ctx.tip)) return REASON.caseDiffers;
    return ctx.bundle.kind === "no_lock_at_base" ? REASON.firstInstall : REASON.notOnBase;
  }
  const lf = withoutCr(bytes);
  if (sameBytes(lf, tipBytes) || sameBytes(lf, bundled)) return REASON.lineEndings;
  const atMergeBase = ctx.mergeBase.get(path);
  if (atMergeBase?.kind === "blob" && sameBytes(bytes, atMergeBase.bytes)) return REASON.behind;
  return REASON.differs;
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
function hasCaseTwin(path: string, entries: ReadonlyMap<string, BaseEntry>): boolean {
  const folded = path.toLowerCase();
  for (const other of entries.keys()) {
    if (other !== path && other.toLowerCase() === folded) return true;
  }
  return false;
}

/** The bytes with every CR before an LF dropped: only ever used to name a reason. */
function withoutCr(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!(bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}

function sameBytes(a: Uint8Array, b: Uint8Array | undefined): boolean {
  if (b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
