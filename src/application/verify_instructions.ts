import type { CheckoutWalk } from "../domain/checkout_trust.ts";
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
import type { BaseEntry } from "../domain/script_trust.ts";
import type { ConfigVerdict } from "../domain/config_trust.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";
import { commitFile, type ConfigBase, type VerifyConfigDeps } from "./verify_config.ts";

/**
 * The instruction half of `specnaut verify-scripts` (`instruction_trust.ts`): what a session and
 * its harness load, judged in the work tree and at HEAD against the base the script check
 * resolved, and the digest a yes to that verdict covers. It reads through the config half's ports.
 */

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
