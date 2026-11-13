import { red } from "@std/fmt/colors";
import { type StartDeps, startReview } from "../../application/review_start.ts";
import { decideTrust } from "../../application/review_trust.ts";
import { type TrustDecision, trustLine } from "../../domain/review_trust.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { GhPullRequests } from "../../infrastructure/gh_pull_request.ts";
import { baseTipOf } from "../../application/verify_scripts.ts";
import { type BranchExport, exportBranchTree } from "../../application/untrusted_review.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { REVIEW_PASS_VAR } from "../../domain/review_gate.ts";
import { FsReviewPass } from "../../infrastructure/fs_review_pass.ts";
import { checkoutState } from "../../infrastructure/git_checkout_state.ts";
import { exportCacheRoot, FsExportStore } from "../../infrastructure/fs_tree_export.ts";
import { keptExport } from "../../infrastructure/fs_kept_export.ts";
import { closeExport, type CloseOutcome } from "../../application/untrusted_review_close.ts";
import { GitBranchFetcher } from "../../infrastructure/git_branch_fetch.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { GitTreeObjects } from "../../infrastructure/git_tree_objects.ts";
import type { ReviewIntent } from "../intent.ts";
import { FsReviewLock } from "../../infrastructure/fs_review_lock.ts";
import { runReviewGate } from "./review_gate_handler.ts";
import { runReviewGuard } from "./review_guard_handler.ts";

/**
 * `specnaut review gate|start|end`, a review that cannot trust its branch:
 *
 *   gate          the PreToolUse hook's check (review_gate_handler.ts)
 *   guard         the PreToolUse hook's review lock (review_guard_handler.ts)
 *   start <src>   takes the gate's pass, only the one `SPECNAUT_REVIEW_PASS` names, locks the
 *                 session it names, exports the branch (a PR number or `<remote>/<branch>`) as
 *                 inert files outside the project, and keeps it. On stdout: `HEAD <sha>`,
 *                 `SEATS <dir>` (the reviewers' copy), `SCRATCH <dir>` (the copy a sandbox runs),
 *                 `OBJECTS <dir>` (the objects folder the explicit-head scripts take), `LOGS <dir>` (the
 *                 one folder a sandboxed run may log to under the lock), then one
 *                 `LISTED <kind> <blob sha> <path>` per entry listed and never written. Exit 0
 *                 started, 1 refused or failed (why on stderr).
 *   trust <pr> <sha>
 *                 prints `trusted`, or `untrusted <why>`, for reviewing PR <pr> at commit <sha>
 *                 (review_trust.ts). Exit 0 trusted, 1 untrusted, whatever made it so.
 *   end <sha>     checks the reviewers' copy of <sha> against the commit once more, then removes the
 *                 kept export. Exit 0 removed (`REMOVED <sha>`) or none there (`NONE <sha>`); 1
 *                 failed, or the copy changed after the start: the review did not read the commit,
 *                 and the export is removed all the same.
 */
const EXIT = { done: 0, failed: 1 } as const;

export type ReviewDeps = {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly start: () => Promise<StartDeps | null>;
  readonly end: (sha: string) => Promise<CloseOutcome>;
  readonly gate: () => Promise<number>;
  readonly guard: () => Promise<number>;
  readonly trust: (pr: string, head: string) => Promise<TrustDecision>;
};

export async function runReview(intent: ReviewIntent, deps = defaultDeps()): Promise<number> {
  if (intent.sub === "gate") return await deps.gate();
  if (intent.sub === "guard") return await deps.guard();
  if (intent.sub === "trust") {
    const decision = await deps.trust(intent.pr, intent.head);
    deps.out(terminalText(trustLine(decision)));
    return decision.trusted ? EXIT.done : EXIT.failed;
  }
  try {
    if (intent.sub === "end") return await end(deps, intent.sha);
    return await start(deps, intent.source);
  } catch (err) {
    return fail(deps, intent.sub, err instanceof Error ? err.message : String(err));
  }
}

async function start(deps: ReviewDeps, source: string): Promise<number> {
  const startDeps = await deps.start();
  if (startDeps === null) return fail(deps, "start", "this folder is in no git repository");
  const outcome = await startReview(startDeps, source);
  if (outcome.kind === "refused") return fail(deps, "start", outcome.why);
  deps.out(startLines(outcome.exported).join("\n"));
  return EXIT.done;
}

async function end(deps: ReviewDeps, sha: string): Promise<number> {
  const closed = await deps.end(sha);
  if (closed.kind === "changed") return fail(deps, "end", `${CHANGED_COPY}: ${closed.why}`);
  deps.out(closed.kind === "removed" ? `REMOVED ${sha}` : `NONE ${sha}`);
  return EXIT.done;
}

/** Why `end` fails when the reviewers' copy no longer reads as the commit. */
export const CHANGED_COPY = "the reviewers' copy changed after the start, so the review did not " +
  "read the commit; the export is removed";

/** What `start` prints: every path and name made inert, one fact per line. */
export function startLines(exported: BranchExport): string[] {
  const t = terminalText;
  return [
    `HEAD ${exported.sha}`,
    `SEATS ${t(exported.seats)}`,
    `SCRATCH ${t(exported.scratch)}`,
    `OBJECTS ${t(`${exported.gitDir}/objects`)}`,
    `LOGS ${t(exported.logs)}`,
    ...exported.listed.map((l) => `LISTED ${t(l.kind)} ${l.sha} ${t(l.path)}`),
  ];
}

function fail(deps: ReviewDeps, sub: string, why: string): number {
  deps.err(red(`error: specnaut review ${sub}: ${terminalText(why)}`));
  return EXIT.failed;
}

function defaultDeps(): ReviewDeps {
  const cwd = Deno.cwd();
  const cache = () => exportCacheRoot(Deno.build.os, (name) => Deno.env.get(name));
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    gate: () => runReviewGate(),
    guard: () => runReviewGuard(),
    trust: (pr, head) => {
      const forge = new GhPullRequests(new DenoSubprocessRunner(), cwd);
      return decideTrust({ pullRequest: (n) => forge.facts(n) }, pr, head);
    },
    end: (sha) => closeExport(closeDeps(cache), sha),
    start: () => startDeps(cwd, cache),
  };
}

function closeDeps(cache: () => string) {
  return {
    kept: (sha: string) => keptExport(cache(), sha),
    objects: (gitDir: string) => new GitTreeObjects(gitDir),
    windows: Deno.build.os === "windows",
  };
}

/** What `start` reads and writes in the repository `cwd` is in; `null` outside one. */
async function startDeps(cwd: string, cache: () => string): Promise<StartDeps | null> {
  const [pass, lock] = await Promise.all([FsReviewPass.open(cwd), FsReviewLock.open(cwd)]);
  if (pass === null || lock === null) return null;
  const exportDeps = {
    fetcher: new GitBranchFetcher(cwd),
    objects: (gitDir: string) => new GitTreeObjects(gitDir),
    store: () => new FsExportStore(cwd, cache()),
    windows: Deno.build.os === "windows",
  };
  const exportBranch = (source: string) => exportBranchTree(exportDeps, { source });
  const baseTip = async () => await baseTipOf(await GitObjects.open(cwd));
  const checkout = () => checkoutState(cwd);
  return {
    pass,
    nonce: Deno.env.get(REVIEW_PASS_VAR) ?? null,
    now: Date.now,
    baseTip,
    checkout,
    lock: (id) => lock.lock(id),
    record: (id, review) => lock.record(id, review),
    exportBranch,
  };
}
