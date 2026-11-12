import { red } from "@std/fmt/colors";
import { type StartDeps, startReview } from "../../application/review_start.ts";
import { baseTipOf } from "../../application/verify_scripts.ts";
import { type BranchExport, exportBranchTree } from "../../application/untrusted_review.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsReviewPass } from "../../infrastructure/fs_review_pass.ts";
import {
  exportCacheRoot,
  FsExportStore,
  removeKeptExport,
} from "../../infrastructure/fs_tree_export.ts";
import { GitBranchFetcher } from "../../infrastructure/git_branch_fetch.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { GitTreeObjects } from "../../infrastructure/git_tree_objects.ts";
import type { ReviewIntent } from "../intent.ts";
import { runReviewGate } from "./review_gate_handler.ts";

/**
 * `specnaut review gate|start|end`, a review that cannot trust its branch:
 *
 *   gate          the PreToolUse hook's check (review_gate_handler.ts)
 *   start <src>   takes the gate's pass, exports the branch (a PR number or `<remote>/<branch>`)
 *                 as inert files outside the project, and keeps it. On stdout: `HEAD <sha>`,
 *                 `SEATS <dir>` (the reviewers' copy), `SCRATCH <dir>` (the copy a sandbox runs),
 *                 `OBJECTS <dir>` (the objects folder the explicit-head scripts take), then one
 *                 `LISTED <kind> <blob sha> <path>` per entry listed and never written. Exit 0
 *                 started, 1 refused or failed (why on stderr).
 *   end <sha>     removes the kept export of <sha>. Exit 0 removed or none there, 1 failed.
 */
const EXIT = { done: 0, failed: 1 } as const;

export type ReviewDeps = {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly start: () => Promise<StartDeps | null>;
  readonly end: (sha: string) => Promise<boolean>;
  readonly gate: () => Promise<number>;
};

export async function runReview(intent: ReviewIntent, deps = defaultDeps()): Promise<number> {
  if (intent.sub === "gate") return await deps.gate();
  try {
    if (intent.sub === "end") {
      const removed = await deps.end(intent.sha);
      deps.out(removed ? `REMOVED ${intent.sha}` : `NONE ${intent.sha}`);
      return EXIT.done;
    }
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

/** What `start` prints: every path and name made inert, one fact per line. */
export function startLines(exported: BranchExport): string[] {
  const t = terminalText;
  return [
    `HEAD ${exported.sha}`,
    `SEATS ${t(exported.seats)}`,
    `SCRATCH ${t(exported.scratch)}`,
    `OBJECTS ${t(`${exported.gitDir}/objects`)}`,
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
    end: (sha) => removeKeptExport(cache(), sha),
    start: async () => {
      const pass = await FsReviewPass.open(cwd);
      if (pass === null) return null;
      const exportDeps = {
        fetcher: new GitBranchFetcher(cwd),
        objects: (gitDir: string) => new GitTreeObjects(gitDir),
        store: () => new FsExportStore(cwd, cache()),
        windows: Deno.build.os === "windows",
      };
      const exportBranch = (source: string) => exportBranchTree(exportDeps, { source });
      const baseTip = async () => await baseTipOf(await GitObjects.open(cwd));
      return { pass, now: Date.now, baseTip, exportBranch };
    },
  };
}
