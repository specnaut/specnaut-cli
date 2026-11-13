import { sameBytes } from "./bytes.ts";
import { inScopeRoot, type ScopeRoot } from "./checkout_scope.ts";
import { type CheckoutWalk, configReasons, holdsBytes } from "./checkout_trust.ts";
import type { ConfigFile, ConfigVerdict } from "./config_trust.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { withoutCr } from "./trust_reason.ts";

/**
 * Whether the instruction files a session takes as its rules hold, in the work tree, what the base
 * branch's tip holds. A branch that edits them steers its own review and merge more than any
 * config input does: `AGENTS.md` is read on every turn, an addendum whenever its phase runs. One
 * class, judged by bytes with the checkout check's walk (`configReasons` in `checkout_trust.ts`):
 * a link that is not the tip's own or leads out of `.specnaut/addenda/`'s compared files, a file
 * the tip lacks, a name that differs in case, a hard link, a tip file the tree lacks: each is one
 * untrusted line, named.
 *
 * Its limit: the session has already read `AGENTS.md` (and `CLAUDE.md`) before the merge's step 0
 * runs this check, so the verdict cannot undo that read. The control is the stop it causes: an
 * untrusted line makes the merge manual, and a person reads the diff before anything lands.
 */

export const INSTRUCTION_CLASS = "instructions";

/** The instruction files, as roots of the checked files (`checkout_scope.ts` holds them all). */
// deno-fmt-ignore
export const INSTRUCTION_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: ["AGENTS.md", "CLAUDE.md"] },
  { dir: ".claude", deep: false, names: ["CLAUDE.md"] },
  { dir: ".specnaut/addenda", deep: true },
  { dir: "docs", deep: false, names: ["constitution.md"] },
];

/**
 * Overrides a session loads beside the instruction files that a project often keeps as a personal,
 * untracked copy. They are judged from git objects, HEAD's against the tip's, so a copy only the
 * work tree holds stays silent and a committed one counts.
 */
export const COMMITTED_INSTRUCTIONS = ["AGENTS.override.md", "CLAUDE.local.md"] as const;

/** One of {@link COMMITTED_INSTRUCTIONS} at HEAD, the base's tip and the merge base. */
export type CommittedInstruction = {
  readonly path: string;
  readonly head: ConfigFile;
  readonly tip: ConfigFile;
  readonly mergeBase: ConfigFile;
};

export type InstructionInput = {
  /** The walk of each {@link INSTRUCTION_SCOPE} root, as the disk holds it. */
  readonly tree: readonly CheckoutWalk[];
  /** The same roots at the base's tip: what trust is measured against. */
  readonly tip: readonly BaseEntry[];
  /** The same roots at the merge base: read only to say a file is behind the base. */
  readonly mergeBase: readonly BaseEntry[];
  readonly committed: readonly CommittedInstruction[];
};

/** One trusted line, or one untrusted line per path, each with its most specific reason. */
export function judgeInstructions(input: InstructionInput): ConfigVerdict[] {
  const found = [...treeReasons(input), ...input.committed.flatMap(committedReason)];
  if (found.length === 0) return [{ class: INSTRUCTION_CLASS, path: ".", trusted: true }];
  return found.map((u) => ({ class: INSTRUCTION_CLASS, ...u, trusted: false }));
}

/** A link counts only into a folder this class compares whole: `.specnaut/addenda/`. */
const inComparedRoot = (path: string) =>
  INSTRUCTION_SCOPE.some((r) => r.deep && inScopeRoot(r, path));

function treeReasons(input: InstructionInput): Untrusted[] {
  const ctx = { tree: treeBytes(input.tree), tip: byPath(input.tip), old: byPath(input.mergeBase) };
  return configReasons(input.tree, input.tip, holdsBytes, inComparedRoot)
    .map((u) => ({ path: u.path, reason: refined(u, ctx) }));
}

/** HEAD's committed copy against the tip's: none at HEAD is silent, whatever the tree holds. */
function committedReason(c: CommittedInstruction): Untrusted[] {
  const why = (reason: string) => [{ path: c.path, reason }];
  if (c.head.kind === "absent") return [];
  if (c.head.kind === "refused") return why(c.head.why);
  if (c.tip.kind === "refused") return why(REASON.baseNotRegular);
  if (c.tip.kind === "file" && sameBytes(c.head.bytes, c.tip.bytes)) return [];
  if (c.mergeBase.kind === "file" && sameBytes(c.head.bytes, c.mergeBase.bytes)) {
    return why(REASON.behind);
  }
  return why(c.tip.kind === "absent" ? REASON.notOnBase : REASON.differs);
}

type Context = {
  readonly tree: ReadonlyMap<string, Uint8Array>;
  readonly tip: ReadonlyMap<string, BaseEntry>;
  readonly old: ReadonlyMap<string, BaseEntry>;
};

/** The checkout check's reason, made the script check's where it says more: CRLF, or behind. */
function refined(u: Untrusted, ctx: Context): string {
  const mine = ctx.tree.get(u.path);
  const tip = blobBytes(ctx.tip.get(u.path));
  if (u.reason === REASON.differs && mine && tip && sameBytes(withoutCr(mine), withoutCr(tip))) {
    return REASON.lineEndings;
  }
  if (u.reason === REASON.differs || u.reason === REASON.notOnBase) {
    return mine && sameBytes(mine, blobBytes(ctx.old.get(u.path))) ? REASON.behind : u.reason;
  }
  // A tip file the branch never had: only the base moved since the branch left it.
  if (u.reason === REASON.missing && !ctx.old.has(u.path)) return REASON.behind;
  return u.reason;
}

function treeBytes(tree: readonly CheckoutWalk[]): ReadonlyMap<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const walk of tree) {
    if (walk.kind !== "walked") continue;
    for (const e of walk.entries) if (e.kind === "file") out.set(e.path, e.bytes);
  }
  return out;
}

function blobBytes(entry: BaseEntry | undefined): Uint8Array | undefined {
  return entry?.kind === "blob" ? entry.bytes : undefined;
}

function byPath(entries: readonly BaseEntry[]): ReadonlyMap<string, BaseEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}
