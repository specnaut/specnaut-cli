import type { ScopeRoot } from "../domain/checkout_scope.ts";
import type { CheckoutEntry, CheckoutWalk } from "../domain/checkout_trust.ts";
import {
  CONFIG_INPUTS,
  type ConfigFile,
  type ConfigVerdict,
  judgeConfig,
} from "../domain/config_trust.ts";
import { INSTRUCTION_SCOPE, judgeInstructions } from "../domain/instruction_trust.ts";
import { type BaseEntry, REASON } from "../domain/script_trust.ts";
import type { BaseFile, CheckoutTreeWalker, GitObjectReader } from "./script_trust_ports.ts";

/**
 * The config half of `specnaut verify-scripts`: each input a branch controls, judged against the
 * base the script check already resolved. The work tree is read through the checkout walk the
 * checkout check uses, so a link is recorded and never followed, and only the named files are read.
 */

export type VerifyConfigDeps = {
  readonly git: GitObjectReader;
  readonly tree: CheckoutTreeWalker;
};

/** The commits the verdicts are measured from: the base's tip and the merge base with HEAD. */
export type ConfigBase = { readonly tip: string; readonly mergeBase: string };

/** Every config input lives directly under `.specnaut/`: one shallow walk reads them all. */
const ROOT: ScopeRoot = {
  dir: ".specnaut",
  deep: false,
  names: CONFIG_INPUTS.map((i) => i.path.slice(".specnaut/".length)),
};

export async function verifyConfig(
  deps: VerifyConfigDeps,
  base: ConfigBase,
): Promise<ConfigVerdict[]> {
  const walk = await deps.tree.walk(ROOT);
  // One read at a time: each spawns git with a piped input, and on Windows a dozen such children
  // started at once hung the run for good, intermittently, on every class in turn.
  const verdicts: ConfigVerdict[] = [];
  for (const input of CONFIG_INPUTS) {
    const tip = await deps.git.readFile(base.tip, input.path);
    const mergeBase = await deps.git.readFile(base.mergeBase, input.path);
    const tree: ConfigFile = walk.kind === "blocked"
      ? { kind: "refused", why: `${walk.path}: ${walk.why}` }
      : treeFile(input.path, walk.entries);
    verdicts.push(
      judgeConfig(input, { tree, tip: commitFile(tip), mergeBase: commitFile(mergeBase) }),
    );
  }
  return verdicts;
}

/**
 * The instruction class (`instruction_trust.ts`): each of its roots walked in the tree and listed at
 * both commits, one at a time for the reason above, then judged as one class.
 */
export async function verifyInstructions(
  deps: VerifyConfigDeps,
  base: ConfigBase,
): Promise<ConfigVerdict[]> {
  const tree: CheckoutWalk[] = [];
  const tip: BaseEntry[] = [];
  const mergeBase: BaseEntry[] = [];
  for (const root of INSTRUCTION_SCOPE) {
    tree.push(await deps.tree.walk(root));
    tip.push(...await deps.git.listRoot(base.tip, root));
    mergeBase.push(...await deps.git.listRoot(base.mergeBase, root));
  }
  return judgeInstructions({ tree, tip, mergeBase });
}

/**
 * What the walk found at one input's path: a regular file linked once is the only one read. The
 * walk matches names without letter case; a name that differs in case is one file on a case-blind
 * disk, which its readers would take, so it is refused rather than called absent.
 */
function treeFile(path: string, entries: readonly CheckoutEntry[]): ConfigFile {
  const entry = entries.find((e) => e.path === path);
  if (entry === undefined) {
    const twin = entries.some((e) => e.path.toLowerCase() === path.toLowerCase());
    return twin ? { kind: "refused", why: REASON.caseDiffers } : { kind: "absent" };
  }
  if (entry.kind === "link") return { kind: "refused", why: REASON.link };
  if (entry.kind === "other") return { kind: "refused", why: REASON.notRegular };
  if (entry.kind === "unreadable") return { kind: "refused", why: `unreadable: ${entry.why}` };
  if (entry.links > 1) return { kind: "refused", why: REASON.hardLinked };
  return { kind: "file", bytes: entry.bytes };
}

function commitFile(file: BaseFile): ConfigFile {
  if (file.kind === "absent") return { kind: "absent" };
  if (file.kind === "not_regular") return { kind: "refused", why: REASON.baseNotRegular };
  return { kind: "file", bytes: file.bytes };
}
