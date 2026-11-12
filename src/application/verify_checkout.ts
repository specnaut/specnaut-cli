import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { judgeCheckout, restartAdvice } from "../domain/checkout_trust.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { ScriptVerdict, Untrusted } from "../domain/script_trust.ts";
import {
  judgeRecord,
  reflogSince,
  SESSION_REASON,
  type SessionRecord,
  startReasons,
  tipDigests,
} from "../domain/session_record.ts";
import { parseRecord } from "../domain/session_record_json.ts";
import type {
  CheckoutTreeWalker,
  GitObjectReader,
  HeadReflogReader,
  SessionRecordReader,
} from "./script_trust_ports.ts";
import { verifyScripts, type VerifyScriptsDeps } from "./verify_scripts.ts";

/**
 * Whether the session's checkout may be trusted to review a branch it does not trust: the rule is
 * {@link judgeCheckout}'s, the base is `specnaut verify-scripts`' (origin's copy of the default
 * branch), and the branch is named by its head's full sha, already fetched as objects. The rule
 * judges the checkout twice: as it is now, and as the session's start record holds it
 * ({@link judgeRecord}), since the harness loaded it then; and each commit HEAD's reflog names
 * since the start must be the tip's, so a branch checked out and left is seen. No record is a
 * failure, never a check of the checkout as it is now alone. Every way the check cannot conclude is
 * a failure with a reason, never a pass; a throw from git is the caller's to report as one.
 */

export type VerifyCheckoutDeps = VerifyScriptsDeps & {
  readonly git: GitObjectReader & HeadReflogReader;
  readonly checkout: CheckoutTreeWalker;
  readonly session: SessionRecordReader;
};

export type CheckoutOutcome =
  | { readonly kind: "trusted"; readonly baseTip: string }
  | {
    readonly kind: "restart";
    readonly reasons: readonly Untrusted[];
    /** What the review tells the user: {@link restartAdvice}. */
    readonly advice: string;
  };

export async function verifyCheckout(
  deps: VerifyCheckoutDeps,
  untrustedHead: string,
): Promise<CheckoutOutcome> {
  if (!isFullSha(untrustedHead)) return restart("head", "not a full commit sha", null);
  const scripts = await verifyScripts(deps);
  if (scripts.kind === "base_unknown") {
    return restart("base", `the base is unknown: ${scripts.why}`, null);
  }
  const tip = scripts.baseTip;
  if (await deps.git.commitOf(untrustedHead) !== untrustedHead) {
    return restart("head", "names no commit in this repository: fetch it first", tip);
  }
  const record = await startRecord(deps);
  if (record.kind === "refused") return restart(SESSION_REASON.path, record.reason, tip);
  return await judged(deps, { tip, untrustedHead, scripts: scripts.verdict }, record.record);
}

/** The checkout judged as it is now, then its start record's reasons the folder does not give. */
async function judged(
  deps: VerifyCheckoutDeps,
  run: { tip: string; untrustedHead: string; scripts: ScriptVerdict },
  record: SessionRecord,
): Promise<CheckoutOutcome> {
  const facts = await gather(deps, run.tip, run.untrustedHead);
  const now = judgeCheckout({ ...facts, scripts: run.scripts }).reasons;
  const told = [...now, ...startReasons(now, await atStart(deps, record, run.tip, facts))];
  const reasons = [...told, ...await sinceStart(deps, record, run.tip, told)];
  if (reasons.length === 0) return { kind: "trusted", baseTip: run.tip };
  return { kind: "restart", reasons, advice: restartAdvice(run.tip) };
}

type Facts = Awaited<ReturnType<typeof gather>>;

/** What the rule reads besides the scripts: each side's commits, the checked files on both sides. */
async function gather(deps: VerifyCheckoutDeps, tip: string, untrustedHead: string) {
  const { git, checkout } = deps;
  const [headCommits, untrustedCommits, tree, atTip] = await Promise.all([
    git.commitsAhead(tip, "HEAD"),
    git.commitsAhead(tip, untrustedHead),
    Promise.all(CHECKOUT_SCOPE.map((root) => checkout.walk(root))),
    Promise.all(CHECKOUT_SCOPE.map((root) => git.listRoot(tip, root))),
  ]);
  return { headCommits, untrustedCommits, tree, tip: atTip.flat() };
}

async function startRecord(
  deps: VerifyCheckoutDeps,
): Promise<{ kind: "found"; record: SessionRecord } | { kind: "refused"; reason: string }> {
  const read = await deps.session.read();
  if (read.kind === "refused") return read;
  const parsed = parseRecord(read.text);
  if (parsed.kind === "parsed") return { kind: "found", record: parsed.record };
  return { kind: "refused", reason: `${SESSION_REASON.malformed}: ${parsed.why}` };
}

/** The reasons the record gives: its HEAD's commits and its files, against the same tip. */
async function atStart(
  deps: VerifyCheckoutDeps,
  record: SessionRecord,
  tip: string,
  facts: Facts,
): Promise<readonly Untrusted[]> {
  if (await deps.git.commitOf(record.head) !== record.head) {
    return [{ path: record.head, reason: SESSION_REASON.headUnknown }];
  }
  return judgeRecord({
    headCommits: await deps.git.commitsAhead(tip, record.head),
    untrustedCommits: facts.untrustedCommits,
    tree: record.tree,
    tip: facts.tip,
    tipDigests: await tipDigests(facts.tip),
  }).reasons;
}

/**
 * The commits HEAD was on since the session started, by its reflog, that the tip does not hold:
 * each one not already told, or one reason when the reflog no longer shows where it stood.
 */
async function sinceStart(
  deps: VerifyCheckoutDeps,
  record: SessionRecord,
  tip: string,
  told: readonly Untrusted[],
): Promise<Untrusted[]> {
  const since = reflogSince(record.reflog, await deps.git.headReflog());
  if (since === null) return [{ path: "HEAD", reason: SESSION_REASON.reflogRewritten }];
  const said = new Set(told.map((u) => u.path));
  const visited: Untrusted[] = [];
  for (const commit of since.filter((c) => !said.has(c))) {
    if (await deps.git.mergeBase(commit, tip) === commit) continue;
    visited.push({ path: commit, reason: SESSION_REASON.visited });
  }
  return visited;
}

function restart(path: string, reason: string, tip: string | null): CheckoutOutcome {
  return { kind: "restart", reasons: [{ path, reason }], advice: restartAdvice(tip) };
}
