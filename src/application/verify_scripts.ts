import type { CoreBundle } from "../domain/core_bundle.ts";
import { baseAnchorRef, branchOfOriginHead, plainBranchName } from "../domain/base_branch.ts";
import { parseLock } from "../domain/installed_lock.ts";
import {
  BASE_LOCK,
  type BundleRule,
  judgeScripts,
  SCRIPTS_DIR,
  type ScriptVerdict,
} from "../domain/script_trust.ts";
import { bundleForLock } from "./lock_bundle.ts";
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

export type VerifyOutcome =
  | { readonly kind: "base_unknown"; readonly why: string }
  | {
    readonly kind: "judged";
    /** The merge base: what the names are listed from. */
    readonly base: string;
    /** The base branch's tip: what trust is measured against. */
    readonly baseTip: string;
    readonly baseBranch: string;
    readonly names: Uint8Array;
    readonly verdict: ScriptVerdict;
  };

export async function verifyScripts(deps: VerifyScriptsDeps): Promise<VerifyOutcome> {
  const { git } = deps;
  const branch = await baseBranchName(git);
  if (branch.kind === "unknown") return { kind: "base_unknown", why: branch.why };
  const hasOrigin = await git.hasOrigin();
  const anchor = baseAnchorRef(branch.name, hasOrigin);
  const baseTip = await git.commitOf(anchor);
  if (baseTip === null) return { kind: "base_unknown", why: `${anchor} names no commit` };
  const head = await git.commitOf("HEAD");
  if (head === null) return { kind: "base_unknown", why: "HEAD names no commit" };
  const base = await git.mergeBase(head, baseTip);
  if (base === null) return { kind: "base_unknown", why: `HEAD shares no history with ${anchor}` };
  const [tip, mergeBase, bundle, tree, names, localBaseAhead] = await Promise.all([
    git.listTree(baseTip, SCRIPTS_DIR),
    git.listTree(base, SCRIPTS_DIR),
    bundleRule(deps, baseTip),
    deps.walker.walk(),
    git.changedNames(base, head),
    localAhead(git, branch.name, anchor, hasOrigin),
  ]);
  const verdict = judgeScripts({ tree, tip, mergeBase, bundle, localBaseAhead });
  return { kind: "judged", base, baseTip, baseBranch: branch.name, names, verdict };
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
async function localAhead(git: GitObjectReader, name: string, anchor: string, hasOrigin: boolean) {
  if (!hasOrigin) return null;
  const local = await git.commitOf(`refs/heads/${name}`);
  if (local === null) return null;
  return await git.aheadCount(anchor, local) > 0 ? name : null;
}

/**
 * The bundled copy, mapped through the lock read at the base's tip. Each way that lock cannot be
 * used is a reason the verdict reports, never a throw.
 */
async function bundleRule(deps: VerifyScriptsDeps, baseTip: string): Promise<BundleRule> {
  const file = await deps.git.readFile(baseTip, BASE_LOCK);
  if (file.kind === "absent") return { kind: "no_lock_at_base" };
  if (file.kind === "not_regular") return unavailable("is not a regular file");
  let lock;
  try {
    lock = parseLock(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  } catch (err) {
    // Reported as the verdict's reason: the caller prints it on the lock's UNTRUSTED line.
    return unavailable(err instanceof Error ? err.message : String(err));
  }
  const bundle = bundleForLock(deps.core, lock, deps.findHarness);
  if (bundle === null) {
    return unavailable(`names a harness this binary does not know: ${lock.harness}`);
  }
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  for (const [dest, entry] of Object.entries(bundle)) {
    if (dest.startsWith(`${SCRIPTS_DIR}/`) && entry.symlinkTo === undefined) {
      files.set(dest, encoder.encode(entry.content));
    }
  }
  return { kind: "mapped", files };
}

const unavailable = (why: string): BundleRule => ({ kind: "unavailable", why });
