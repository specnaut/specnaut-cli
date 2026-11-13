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
import {
  PARENT_INSTRUCTIONS,
  parentReasons,
  type ParentSides,
} from "../domain/instruction_parents.ts";
import { keptAtHead } from "../domain/instruction_scope.ts";
import { linkEnd } from "../domain/head_link.ts";
import { headDigest } from "../domain/script_digest.ts";
import { type ShippedCopy, shippedReasons } from "../domain/shipped_skills.ts";
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
 * The instruction verdict, and the digest a yes to it covers: {@link headDigest} of HEAD's files
 * and of the reasons the verdict shows.
 */
export type InstructionOutcome = {
  readonly verdicts: readonly ConfigVerdict[];
  readonly digest: string;
};

/**
 * The instruction class (`instruction_trust.ts`): each of its roots walked in the tree and listed at
 * the tip, the merge base and HEAD, one at a time for the reason above, then judged as one class,
 * HEAD's skills against `shipped` too (`shippedSkills` in `shipped_copies.ts`), and the files above
 * a project in a subfolder (`instruction_parents.ts`).
 */
export async function verifyInstructions(
  deps: VerifyConfigDeps,
  base: InstructionBase,
  shipped: ReadonlyMap<string, ShippedCopy> = new Map(),
): Promise<InstructionOutcome> {
  const { tree, tip, mergeBase } = await listRoots(deps, base);
  const head = await deps.git.listCommit(base.head, keptAtHead);
  const committed = await readCommitted(deps.git, base);
  const symlinks = await deps.git.symlinks();
  const files = head.flatMap((e) => e.kind === "tree" ? [] : [e]);
  const parents = await readParents(deps.git, base);
  const extra = [...await shippedReasons(files, shipped), ...parentReasons(parents)];
  const verdicts = judgeInstructions({ tree, tip, mergeBase, head, committed, symlinks, extra });
  const ends = await linkEnds(deps.git, base.head, files);
  const shown = verdicts.flatMap((v) => v.trusted ? [] : [{ path: v.path, reason: v.reason }]);
  return { verdicts, digest: await headDigest([...files, ...parents.head], ends, shown) };
}

/** The files above the project ({@link PARENT_INSTRUCTIONS}) at HEAD, the tip and the merge base. */
async function readParents(git: GitObjectReader, base: InstructionBase): Promise<ParentSides> {
  const head = await git.listParents(base.head, PARENT_INSTRUCTIONS);
  const tip = await git.listParents(base.tip, PARENT_INSTRUCTIONS);
  return { head, tip, mergeBase: await git.listParents(base.mergeBase, PARENT_INSTRUCTIONS) };
}

/**
 * The bytes HEAD holds where each of its listed links leads (`linkEnd` in `head_link.ts`), read
 * from HEAD's tree whether or not this class lists that path: what the digest frames a link by.
 */
async function linkEnds(
  git: GitObjectReader,
  head: string,
  files: readonly BaseEntry[],
): Promise<Map<string, Uint8Array>> {
  const listed = new Map(files.map((e) => [e.path, e]));
  const ends = new Map<string, Uint8Array>();
  for (const e of files) {
    const end = e.kind === "link" ? linkEnd(e.path, e.target ?? "") : null;
    if (end === null) continue;
    const at = listed.get(end);
    const read = at === undefined ? await git.readFile(head, end) : null;
    const bytes = at?.kind === "blob" ? at.bytes : read?.kind === "blob" ? read.bytes : undefined;
    if (bytes !== undefined) ends.set(e.path, bytes);
  }
  return ends;
}

/** The commits the instruction class reads: the config's two, and HEAD, what lands. */
export type InstructionBase = ConfigBase & { readonly head: string };

/**
 * Each {@link INSTRUCTION_SCOPE} root walked in the tree and listed at the tip and the merge base.
 * HEAD is listed whole instead (`keptAtHead`), so a name in another letter case is seen.
 */
async function listRoots(deps: VerifyConfigDeps, base: InstructionBase) {
  const tree: CheckoutWalk[] = [];
  const tip: BaseEntry[] = [];
  const mergeBase: BaseEntry[] = [];
  for (const root of INSTRUCTION_SCOPE) {
    tree.push(await deps.tree.walk(root));
    tip.push(...await deps.git.listRoot(base.tip, root));
    mergeBase.push(...await deps.git.listRoot(base.mergeBase, root));
  }
  return { tree, tip, mergeBase };
}

/** Each of {@link COMMITTED_INSTRUCTIONS} at the tip and the merge base: HEAD's is listed whole. */
async function readCommitted(
  git: GitObjectReader,
  base: InstructionBase,
): Promise<CommittedInstruction[]> {
  const committed: CommittedInstruction[] = [];
  for (const path of COMMITTED_INSTRUCTIONS) {
    const tip = commitFile(await git.readFile(base.tip, path));
    committed.push({ path, tip, mergeBase: commitFile(await git.readFile(base.mergeBase, path)) });
  }
  return committed;
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
