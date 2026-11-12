import { sameBytes } from "./bytes.ts";
import { REASON } from "./script_trust.ts";

/**
 * Whether the config inputs a branch can edit hold, in the work tree, what the base branch's tip
 * holds. The phases read these inputs from the work tree through their helper scripts; a phase
 * reads one only when its verdict here is trusted, so the value it reads is the tip's. One verdict
 * per input class, judged on the value its readers take, not on the whole file: grooming writes a
 * column into `backlog-config.yml`, and a merge marks `feature.json` partial, on the branch itself.
 *
 * Its limit is the script check's: it guards against mistakes (a branch that edits the config that
 * grades or lands it), not deliberate rewrites.
 */

/** The value a class is judged on: the file's raw bytes, or what its readers take from it. */
type Value = "bytes" | "repo" | "linked_issue";

/** One config input a branch controls: its class, the file under the project's root, its value. */
export type ConfigInput = {
  readonly class: string;
  readonly path: string;
  readonly value: Value;
};

// deno-fmt-ignore
export const CONFIG_INPUTS: readonly ConfigInput[] = [
  { class: "workflow", path: ".specnaut/workflow.yml", value: "bytes" },
  { class: "size-limits", path: ".specnaut/size-limits.yml", value: "bytes" },
  { class: "boundaries", path: ".specnaut/boundaries.yml", value: "bytes" },
  { class: "backlog-repo", path: ".specnaut/backlog-config.yml", value: "repo" },
  { class: "linked-issue", path: ".specnaut/feature.json", value: "linked_issue" },
  { class: "gates", path: ".specnaut/gates.yml", value: "bytes" },
];

/** One path as the work tree holds it, or as a commit does. */
export type ConfigFile =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly why: string };

export type ConfigSides = {
  readonly tree: ConfigFile;
  /** The base branch's tip: what trust is measured against. */
  readonly tip: ConfigFile;
  /** The merge base: read only to say the input is behind the base rather than edited. */
  readonly mergeBase: ConfigFile;
};

export type ConfigVerdict =
  | { readonly class: string; readonly path: string; readonly trusted: true }
  | {
    readonly class: string;
    readonly path: string;
    readonly trusted: false;
    readonly reason: string;
  };

/** The verdict of one input: trusted only when the tree's value is the tip's. */
export function judgeConfig(input: ConfigInput, sides: ConfigSides): ConfigVerdict {
  const reason = configReason(input, sides);
  const head = { class: input.class, path: input.path };
  return reason === null ? { ...head, trusted: true } : { ...head, trusted: false, reason };
}

function configReason(input: ConfigInput, sides: ConfigSides): string | null {
  const { tree, tip } = sides;
  if (tree.kind === "refused") return tree.why;
  if (tip.kind === "refused") return REASON.baseNotRegular;
  if (tree.kind === "absent") return tip.kind === "absent" ? null : REASON.missing;
  if (tip.kind === "absent") {
    return isBehind(input, tree, sides.mergeBase) ? REASON.behind : REASON.notOnBase;
  }
  if (sameBytes(valueOf(input, tree.bytes), valueOf(input, tip.bytes))) return null;
  return isBehind(input, tree, sides.mergeBase) ? REASON.behind : REASON.differs;
}

/** The tree's value is the merge base's: only the base moved since the branch left it. */
function isBehind(input: ConfigInput, tree: { bytes: Uint8Array }, mergeBase: ConfigFile) {
  if (mergeBase.kind !== "file") return false;
  return sameBytes(valueOf(input, tree.bytes), valueOf(input, mergeBase.bytes));
}

/**
 * What a class's readers take from the file, as bytes to compare. `repo`: every line starting
 * `repo:`, as written (the backlog scripts read the first). `linked_issue`: every
 * `"linked_issue": <token>` as written (the sed readers take the first, jq the last), so two
 * files a reader could tell apart never compare equal.
 */
function valueOf(input: ConfigInput, bytes: Uint8Array): Uint8Array {
  if (input.value === "bytes") return bytes;
  const text = new TextDecoder().decode(bytes);
  const pattern = input.value === "repo"
    ? /^repo:.*$/gm
    : /"linked_issue"[ \t\r\n]*:[ \t\r\n]*[^,}\s]*/g;
  return new TextEncoder().encode((text.match(pattern) ?? []).join("\n"));
}
