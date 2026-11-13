import type { ScopeRoot } from "../domain/checkout_scope.ts";
import type { CheckoutEntry, CheckoutWalk } from "../domain/checkout_trust.ts";
import {
  CONFIG_INPUTS,
  type ConfigFile,
  type ConfigVerdict,
  judgeConfig,
} from "../domain/config_trust.ts";
import {
  COMMITTED_INSTRUCTIONS,
  type CommittedInstruction,
  INSTRUCTION_SCOPE,
  judgeInstructions,
} from "../domain/instruction_trust.ts";
import { headDigest, type HeadEntry } from "../domain/script_digest.ts";
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

/** The instruction verdict, and the digest a yes to it covers: {@link headDigest} of HEAD's files. */
export type InstructionOutcome = {
  readonly verdicts: readonly ConfigVerdict[];
  readonly digest: string;
};

/**
 * The instruction class (`instruction_trust.ts`): each of its roots walked in the tree and listed at
 * the tip, the merge base and HEAD, one at a time for the reason above, then judged as one class.
 */
export async function verifyInstructions(
  deps: VerifyConfigDeps,
  base: InstructionBase,
): Promise<InstructionOutcome> {
  const { tree, tip, mergeBase, head } = await listRoots(deps, base);
  const committed = await readCommitted(deps.git, base);
  const symlinks = await deps.git.symlinks();
  const verdicts = judgeInstructions({ tree, tip, mergeBase, head, committed, symlinks });
  return { verdicts, digest: await headDigest([...head, ...committed.flatMap(atHead)]) };
}

/** The commits the instruction class reads: the config's two, and HEAD, what lands. */
export type InstructionBase = ConfigBase & { readonly head: string };

/** Each {@link INSTRUCTION_SCOPE} root walked in the tree and listed at the three commits. */
async function listRoots(deps: VerifyConfigDeps, base: InstructionBase) {
  const tree: CheckoutWalk[] = [];
  const tip: BaseEntry[] = [];
  const mergeBase: BaseEntry[] = [];
  const head: BaseEntry[] = [];
  for (const root of INSTRUCTION_SCOPE) {
    tree.push(await deps.tree.walk(root));
    tip.push(...await deps.git.listRoot(base.tip, root));
    mergeBase.push(...await deps.git.listRoot(base.mergeBase, root));
    head.push(...await deps.git.listRoot(base.head, root));
  }
  return { tree, tip, mergeBase, head };
}

/** Each of {@link COMMITTED_INSTRUCTIONS} at HEAD, the tip and the merge base. */
async function readCommitted(
  git: GitObjectReader,
  base: InstructionBase,
): Promise<CommittedInstruction[]> {
  const committed: CommittedInstruction[] = [];
  for (const path of COMMITTED_INSTRUCTIONS) {
    const atHead = await git.readFile(base.head, path);
    committed.push({
      path,
      head: atHead.kind === "not_regular"
        ? { kind: "refused", why: REASON.notRegular }
        : commitFile(atHead),
      tip: commitFile(await git.readFile(base.tip, path)),
      mergeBase: commitFile(await git.readFile(base.mergeBase, path)),
    });
  }
  return committed;
}

/** An override as HEAD commits it, for the digest: none when HEAD has no such path. */
function atHead(c: CommittedInstruction): HeadEntry[] {
  if (c.head.kind === "absent") return [];
  if (c.head.kind === "refused") return [{ kind: "not_regular", path: c.path }];
  return [{ kind: "blob", path: c.path, bytes: c.head.bytes }];
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
