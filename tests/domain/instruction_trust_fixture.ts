import type { CheckoutEntry, CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import { type InstructionInput, judgeInstructions } from "../../src/domain/instruction_trust.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/** The entries and the HEAD-aware judge the instruction-class tests share. */

export const enc = (s: string) => new TextEncoder().encode(s);
export const RULES = enc("# Rules\n\nRun every gate.\n");
export const A = "AGENTS.md";
export const file = (path: string, bytes = RULES, links = 1): CheckoutEntry => ({
  kind: "file",
  path,
  bytes,
  links,
  id: `1:${path}`,
});
export const blob = (path: string, bytes: Uint8Array = RULES): BaseEntry => ({
  kind: "blob",
  path,
  bytes,
});
export const walked = (
  ...entries: CheckoutEntry[]
): CheckoutWalk[] => [{ kind: "walked", entries }];

/** The verdicts for this tree and HEAD, against a tip that holds `AGENTS.md` unless given. */
export function judge(over: Partial<InstructionInput> & Pick<InstructionInput, "tree" | "head">) {
  const tip = over.tip ?? [blob(A)];
  const input = { tip, mergeBase: tip, committed: [], symlinks: true, ...over };
  return judgeInstructions(input).map((v) => v.trusted ? "trusted" : `${v.path} ${v.reason}`);
}
