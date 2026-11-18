import { type ClassNow, instructionsApprovable } from "../domain/approval_verdict.ts";
import type { ConfigVerdict } from "../domain/config_trust.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { INSTRUCTION_CLASS } from "../domain/instruction_trust.ts";
import { APPROVALS_FILE } from "../domain/skill_approvals.ts";
import type { Harness } from "./ports.ts";
import type { CheckoutTreeWalker, GitObjectReader } from "./script_trust_ports.ts";
import { type ShippedInput, shippedInput } from "./shipped_copies.ts";
import { verifyConfig } from "./verify_config.ts";
import { type InstructionBase, verifyInstructions } from "./verify_instructions.ts";

/**
 * The config and instruction verdicts of a branch, measured from one base: the one judge both
 * `specnaut verify-scripts` and `specnaut record-approvals` run, so a yes the first printed the
 * digest of is the yes the second checks.
 */

export type JudgeDeps = {
  readonly git: GitObjectReader;
  readonly tree: CheckoutTreeWalker;
  readonly core: CoreBundle;
  readonly findHarness: (key: string) => Harness | null;
};

/** The config and instruction lines, the digest a yes to the instruction lines covers, and what the
 * shipped-skill rule read. */
export type Judged = {
  readonly verdicts: readonly ConfigVerdict[];
  readonly digest: string | null;
  readonly shipped: ShippedInput | null;
  /** Whether HEAD commits anything at the approvals file's path: what a yes may not cover. */
  readonly approvalsAtHead: boolean;
};

/** The config, then the instruction verdicts, measured from `base`; none when it is unknown. */
export async function judgeInputs(deps: JudgeDeps, base: InstructionBase | null): Promise<Judged> {
  if (base === null) return { verdicts: [], digest: null, shipped: null, approvalsAtHead: true };
  const { git, tree } = deps;
  const config = await verifyConfig({ git, tree }, base);
  const shipped = await shippedInput(deps, base);
  const instructions = await verifyInstructions({ git, tree }, base, shipped);
  const verdicts = [...config, ...instructions.verdicts];
  const approvalsAtHead = (await git.readFile(base.head, APPROVALS_FILE)).kind !== "absent";
  return { verdicts, digest: instructions.digest, shipped, approvalsAtHead };
}

/** The instruction class as judged: what a yes to its digest is compared with. */
export function instructionsNow(judged: Judged): ClassNow {
  const lines = judged.verdicts.filter((v) => v.class === INSTRUCTION_CLASS);
  return {
    trusted: lines.some((v) => v.trusted),
    digest: judged.digest ?? "",
    approvable: instructionsApprovable(
      lines.flatMap((v) => v.trusted ? [] : [v]),
      judged.approvalsAtHead,
    ),
  };
}
