import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { judgeCheckout, restartAdvice } from "../domain/checkout_trust.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { ScriptVerdict, Untrusted } from "../domain/script_trust.ts";
import { reflogSince } from "../domain/head_reflog.ts";
import {
  judgeRecord,
  SESSION_REASON,
  type SessionRecord,
  startReasons,
  tipDigests,
} from "../domain/session_record.ts";
import { parseRecord } from "../domain/session_record_json.ts";
import type {
  CheckoutTreeWalker,
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
 *
 * The reflog sees HEAD's moves only. A command that writes another commit's files into the folder
 * without moving HEAD leaves no entry naming that commit: `git checkout B -- path`, `git restore
 * --source`, `git stash apply`, and a merge stopped on a conflict, whose `git merge --abort` writes
 * an entry from HEAD to HEAD alone. A checked file such a command leaves changed is seen, since the
 * folder is judged as it is now; one changed and put back before the check is not. The checked
 * files' ctimes are not compared with the record's to close that: a ctime also moves when the same
 * bytes are written again, as an editor saving an unchanged file or `git stash` and its `pop` do,
 * and on a change of mode or owner, so it would refuse sessions that changed nothing it reads.
 *
 * Nor does the reflog keep what git expires. A visit to a commit no branch holds is expired as
 * unreachable once older than `gc.reflogExpireUnreachable` (30 days unless set); when a `git gc`
 * during the session removes the session's own entries and keeps every older one, the mark still
 * matches and the visit is not seen. One that removes entries from before the start is refused.
 */

export type VerifyCheckoutDeps = VerifyScriptsDeps & {
  readonly reflog: HeadReflogReader;
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
  untrustedHead: string | null,
): Promise<CheckoutOutcome> {
  if (untrustedHead !== null && !isFullSha(untrustedHead)) {
    return restart("head", "not a full commit sha", null);
  }
  const scripts = await verifyScripts(deps);
  if (scripts.kind === "base_unknown") {
    return restart("base", `the base is unknown: ${scripts.why}`, null);
  }
  const tip = scripts.baseTip;
  if (untrustedHead !== null && await deps.git.commitOf(untrustedHead) !== untrustedHead) {
    return restart("head", "names no commit in this repository: fetch it first", tip);
  }
  const record = await startRecord(deps);
  if (record.kind === "refused") return await noRecord(deps, record.reason, tip);
  return await judged(deps, { tip, untrustedHead, scripts: scripts.verdict }, record.record);
}

/**
 * No record to judge by: its reason, and the reflog's when that cannot be read either, since a
 * repository with no reflog to read (one whose refs are in a reftable) never takes a record.
 */
async function noRecord(
  deps: VerifyCheckoutDeps,
  why: string,
  tip: string,
): Promise<CheckoutOutcome> {
  const log = await readReflog(deps);
  const reasons: Untrusted[] = [{ path: SESSION_REASON.path, reason: why }];
  if (log.kind === "unreadable") reasons.push({ path: "HEAD", reason: log.reason });
  return { kind: "restart", reasons, advice: restartAdvice(tip) };
}

/** The checkout judged as it is now, then its start record's reasons the folder does not give. */
async function judged(
  deps: VerifyCheckoutDeps,
  run: { tip: string; untrustedHead: string | null; scripts: ScriptVerdict },
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
async function gather(deps: VerifyCheckoutDeps, tip: string, untrustedHead: string | null) {
  const { git, checkout } = deps;
  const [headCommits, untrustedCommits, tree, atTip, symlinks] = await Promise.all([
    git.commitsAhead(tip, "HEAD"),
    untrustedHead === null ? [] : git.commitsAhead(tip, untrustedHead),
    Promise.all(CHECKOUT_SCOPE.map((root) => checkout.walk(root))),
    Promise.all(CHECKOUT_SCOPE.map((root) => git.listRoot(tip, root))),
    git.symlinks(),
  ]);
  return { headCommits, untrustedCommits, tree, tip: atTip.flat(), symlinks };
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
    tipDigests: await tipDigests(facts.tip, facts.symlinks),
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
  const log = await readReflog(deps);
  if (log.kind === "unreadable") return [{ path: "HEAD", reason: log.reason }];
  const since = log.bytes === null ? null : await reflogSince(record.reflog, log.bytes);
  if (since === null) return [{ path: "HEAD", reason: SESSION_REASON.reflogRewritten }];
  const said = new Set(told.map((u) => u.path));
  const visited: Untrusted[] = [];
  for (const commit of since.filter((c) => !said.has(c))) {
    if (await deps.git.mergeBase(commit, tip) === commit) continue;
    visited.push({ path: commit, reason: SESSION_REASON.visited });
  }
  return visited;
}

/** The reflog's bytes, or why it cannot be read: a link, or a file over the cap, is a reason. */
async function readReflog(
  deps: VerifyCheckoutDeps,
): Promise<{ kind: "read"; bytes: Uint8Array | null } | { kind: "unreadable"; reason: string }> {
  try {
    return { kind: "read", bytes: await deps.reflog.headReflog() };
  } catch (err) {
    // Not swallowed: the failure is the reason the check refuses with.
    if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
    return { kind: "unreadable", reason: `${SESSION_REASON.reflogUnreadable}: ${err.message}` };
  }
}

function restart(path: string, reason: string, tip: string | null): CheckoutOutcome {
  return { kind: "restart", reasons: [{ path, reason }], advice: restartAdvice(tip) };
}
