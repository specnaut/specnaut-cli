import type { CoreBundle } from "../domain/core_bundle.ts";
import { baseAnchorRef, branchOfOriginHead, plainBranchName } from "../domain/base_branch.ts";
import { projectRelative } from "../domain/project_names.ts";
import { scriptsDigest } from "../domain/script_digest.ts";
import {
  type BundleRule,
  judgeScripts,
  SCRIPTS_DIR,
  type ScriptVerdict,
} from "../domain/script_trust.ts";
import { baseLock, unavailable } from "./base_lock.ts";
import { bundledScripts, bundleForLock } from "./lock_bundle.ts";
import type { Harness } from "./ports.ts";
import type { GitObjectReader, ScriptTreeWalker } from "./script_trust_ports.ts";

/**
 * `specnaut verify-scripts`: whether the helper scripts a review or a merge is about to run match
 * a copy the branch under review does not carry. The base is computed here, never by a script of
 * the tree: origin/HEAD, else the user's global `init.defaultBranch`, read at origin's copy.
 */

export type VerifyScriptsDeps = {
  readonly git: GitObjectReader;
  readonly walker: ScriptTreeWalker;
  readonly core: CoreBundle;
  readonly findHarness: (key: string) => Harness | null;
};

/** Where the check measures from: the base's name, its tip, and the merge base with HEAD. */
type Base = {
  readonly kind: "known";
  readonly branch: string;
  readonly anchor: string;
  readonly hasOrigin: boolean;
  readonly tip: string;
  readonly head: string;
  readonly mergeBase: string;
};
type Unknown = { readonly kind: "base_unknown"; readonly why: string };

export type VerifyOutcome = Unknown | {
  readonly kind: "judged";
  /** The merge base: what the names are listed from. */
  readonly base: string;
  /** The base branch's tip: what trust is measured against. */
  readonly baseTip: string;
  /** The commit HEAD named when the base was resolved. */
  readonly head: string;
  readonly baseBranch: string;
  /** The changed paths, relative to the project's folder. */
  readonly names: readonly string[];
  /** The project's folder under the repository's top, `.` at the top. */
  readonly namesRelativeTo: string;
  /** What an approval of this verdict covers: the folder's bytes as walked. */
  readonly digest: string;
  readonly verdict: ScriptVerdict;
};

export async function verifyScripts(deps: VerifyScriptsDeps): Promise<VerifyOutcome> {
  const base = await resolveBase(deps.git);
  if (base.kind === "base_unknown") return base;
  const { git } = deps;
  const [tip, mergeBase, bundle, tree, names, localBaseAhead] = await Promise.all([
    git.listTree(base.tip, SCRIPTS_DIR),
    git.listTree(base.mergeBase, SCRIPTS_DIR),
    bundleRule(deps, base.tip),
    deps.walker.walk(),
    git.changedNames(base.mergeBase, base.head),
    localAhead(git, base),
  ]);
  const verdict = judgeScripts({ tree, tip, mergeBase, bundle, localBaseAhead });
  return { ...judged(base, git.projectPrefix, names), digest: await scriptsDigest(tree), verdict };
}

/** The outcome's fields that come from the base and the names. */
function judged(base: Base, prefix: string, names: readonly string[]) {
  return {
    kind: "judged" as const,
    base: base.mergeBase,
    baseTip: base.tip,
    head: base.head,
    baseBranch: base.branch,
    names: projectRelative(names, prefix),
    namesRelativeTo: prefix.replace(/\/$/, "") || ".",
  };
}

/** The base branch's tip as the check resolves it, or `null` when it cannot. */
export async function baseTipOf(git: GitObjectReader): Promise<string | null> {
  const base = await resolveBase(git);
  return base.kind === "known" ? base.tip : null;
}

async function resolveBase(git: GitObjectReader): Promise<Base | Unknown> {
  const branch = await baseBranchName(git);
  if (branch.kind === "unknown") return { kind: "base_unknown", why: branch.why };
  const hasOrigin = await git.hasOrigin();
  const anchor = baseAnchorRef(branch.name, hasOrigin);
  const tip = await git.commitOf(anchor);
  if (tip === null) return { kind: "base_unknown", why: `${anchor} names no commit` };
  const head = await git.commitOf("HEAD");
  if (head === null) return { kind: "base_unknown", why: "HEAD names no commit" };
  const mergeBase = await git.mergeBase(head, tip);
  if (mergeBase === null) {
    return { kind: "base_unknown", why: `HEAD shares no history with ${anchor}` };
  }
  return { kind: "known", branch: branch.name, anchor, hasOrigin, tip, head, mergeBase };
}

type BranchName = { kind: "known"; name: string } | { kind: "unknown"; why: string };

/** `base-branch.sh`'s order, with the configuration read globally: the tree cannot change it. */
async function baseBranchName(git: GitObjectReader): Promise<BranchName> {
  const head = await git.originHead();
  if (head !== null) {
    const name = branchOfOriginHead(head);
    if (name !== null) return { kind: "known", name };
    return { kind: "unknown", why: "origin/HEAD names no plain branch" };
  }
  const configured = await git.globalDefaultBranch();
  if (configured !== null) {
    const name = plainBranchName(configured);
    if (name !== null) return { kind: "known", name };
    return { kind: "unknown", why: "init.defaultBranch is not a plain branch name" };
  }
  return { kind: "unknown", why: "no origin/HEAD and no global init.defaultBranch" };
}

/** The base's name when the local branch holds commits origin's copy lacks. */
async function localAhead(git: GitObjectReader, base: Base): Promise<string | null> {
  if (!base.hasOrigin) return null;
  const local = await git.commitOf(`refs/heads/${base.branch}`);
  if (local === null) return null;
  return await git.aheadCount(base.anchor, local) > 0 ? base.branch : null;
}

/**
 * The bundled copy, mapped through the lock read at the base's tip. Each way that lock cannot be
 * used is a reason the verdict reports, never a throw.
 */
async function bundleRule(deps: VerifyScriptsDeps, baseTip: string): Promise<BundleRule> {
  const lock = await baseLock(deps.git, baseTip);
  if (!("entries" in lock)) return lock;
  const bundle = bundleForLock(deps.core, lock, deps.findHarness);
  if (bundle === null) {
    return unavailable(`names a harness this binary does not know: ${lock.harness}`);
  }
  const enc = new TextEncoder();
  const files = new Map(
    [...bundledScripts(bundle)].map(([dest, text]) => [dest, enc.encode(text)]),
  );
  return { kind: "mapped", files };
}
