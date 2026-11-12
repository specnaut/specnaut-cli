import { dirname, join, normalize } from "@std/path/posix";
import {
  type BaseEntry,
  hasCaseTwin,
  REASON,
  SCRIPTS_DIR,
  type ScriptVerdict,
  type TreeEntry,
  type TreeWalk,
  type Untrusted,
} from "./script_trust.ts";
import { sameBytes } from "./bytes.ts";

/**
 * Whether the checkout a session runs in may steer the review of a branch it does not trust. The
 * harness loads its settings, hooks, agents and skills from that checkout when the session starts,
 * and the review then follows its instructions, helper scripts and config: if any of them came
 * from the branch, the branch has already chosen how it is reviewed. So the checkout is trusted
 * only when all three hold:
 *
 * 1. HEAD is the base's tip or one of its ancestors: it holds no commit the tip lacks, the
 *    branch's or any other, since any of them could carry the branch's files;
 * 2. the helper scripts are trusted, as {@link judgeScripts} judges them (the bundle is their
 *    second copy);
 * 3. every file in {@link CHECKOUT_SCOPE} equals its blob at the base's tip, byte for byte, and the
 *    tip has every one the tree has: no extra file, untracked or ignored ones included.
 *
 * Anything else stops the review, which never falls back to reading the checkout as it is.
 */

/**
 * A folder of the checked files: every entry below it when `deep`, else only its own files, those
 * `names` lists when it lists any (matched without letter case: one file on a case-blind disk).
 */
export type ScopeRoot = {
  readonly dir: string;
  readonly deep: boolean;
  readonly names?: readonly string[];
};

/**
 * The instruction and config files a session or a review reads, and the version-manager files that
 * could put another `specnaut`, `git` or `gh` first on the PATH. `.specnaut/scripts/` is not here:
 * the script check judges it, with the bundle as a second copy.
 */
// deno-fmt-ignore
export const CHECKOUT_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: [
    "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".mcp.json",
    ".tool-versions", "mise.toml", ".mise.toml", "mise.local.toml", ".mise.local.toml",
    ".rtx.toml", ".envrc", ".prototools", "devbox.json",
  ] },
  { dir: ".claude", deep: true },
  { dir: ".codex", deep: true },
  { dir: ".agents", deep: true },
  { dir: ".specnaut", deep: false },
  { dir: ".specnaut/hooks", deep: true },
  { dir: ".specnaut/codex", deep: true },
  { dir: ".specnaut/addenda", deep: true },
  { dir: ".specnaut/memory", deep: true },
  { dir: "docs", deep: false, names: ["constitution.md"] },
  { dir: ".mise", deep: true },
  { dir: ".config", deep: false, names: ["mise.toml"] },
  { dir: ".config/mise", deep: true },
];

/** Whether `path`, relative to the project's root, belongs to `root`. */
export function inScopeRoot(root: ScopeRoot, path: string): boolean {
  if (root.deep && path === root.dir) return true; // the folder itself: a link or a submodule
  const prefix = root.dir === "." ? "" : `${root.dir}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return false;
  if (root.deep) return true;
  const name = path.slice(prefix.length);
  if (name.includes("/")) return false;
  const folded = name.toLowerCase();
  return root.names === undefined || root.names.some((n) => n.toLowerCase() === folded);
}

/** Whether `path` is one of the checked files. */
export function inCheckoutScope(path: string): boolean {
  return !path.startsWith(`${SCRIPTS_DIR}/`) && CHECKOUT_SCOPE.some((r) => inScopeRoot(r, path));
}

export type CheckoutInput = {
  /** The commits of base..HEAD. */
  readonly headCommits: readonly string[];
  /** The commits of base..<the branch's head>: only to say which reason a commit of HEAD gets. */
  readonly untrustedCommits: readonly string[];
  readonly scripts: ScriptVerdict;
  /** The walk of each {@link CHECKOUT_SCOPE} root, as the disk holds it. */
  readonly tree: readonly TreeWalk[];
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
} as const;

/** What a failed check tells the user: the only way on. */
export const RESTART_ADVICE =
  "This checkout is not the base: restart the session from a clean checkout of the base branch. " +
  "The review does not run from this checkout as it is.";

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
  const entries: TreeEntry[] = [];
  for (const walk of input.tree) {
    if (walk.kind === "blocked") out.push({ path: walk.path, reason: walk.why });
    else entries.push(...walk.entries.filter((e) => inCheckoutScope(e.path)));
  }
  const tip = input.tip.filter((e) => inCheckoutScope(e.path));
  const atTip = new Map(tip.map((e) => [e.path, e]));
  for (const entry of entries) {
    const reason = entryReason(entry, atTip);
    if (reason !== null) out.push({ path: entry.path, reason });
  }
  const inTree = new Set(entries.map((e) => e.path));
  for (const base of tip) {
    if (base.kind === "submodule") out.push({ path: base.path, reason: REASON.submodule });
    else if (!inTree.has(base.path)) out.push({ path: base.path, reason: REASON.missing });
  }
  return out;
}

function entryReason(entry: TreeEntry, atTip: ReadonlyMap<string, BaseEntry>): string | null {
  if (entry.kind === "other") return REASON.notRegular;
  if (entry.kind === "unreadable") return `unreadable: ${entry.why}`;
  const base = atTip.get(entry.path);
  if (base === undefined) {
    return hasCaseTwin(entry.path, atTip) ? REASON.caseDiffers : REASON.notOnBase;
  }
  if (entry.kind === "link") return linkReason(entry, base);
  if (entry.links > 1) return REASON.hardLinked;
  if (base.kind === "blob" && sameBytes(entry.bytes, base.bytes)) return null;
  // A link checked out where links are off is a file holding the link's target: the tip's blob.
  if (base.kind === "link" && base.target !== undefined) {
    if (sameBytes(entry.bytes, new TextEncoder().encode(base.target))) return null;
  }
  return REASON.differs;
}

/** A link holds only as the tip's own link, and only when it leads to another checked file. */
function linkReason(entry: TreeEntry & { kind: "link" }, base: BaseEntry): string | null {
  if (base.kind !== "link" || entry.target === undefined || entry.target !== base.target) {
    return REASON.differs;
  }
  const to = normalize(join(dirname(entry.path), entry.target));
  return entry.target.startsWith("/") || !inCheckoutScope(to) ? CHECKOUT_REASON.linkLeaves : null;
}
