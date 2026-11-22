import { red, yellow } from "@std/fmt/colors";
import { recordApprovals, type RecordOutcome } from "../../application/record_approvals.ts";
import type { CheckoutTreeWalker, GitObjectReader } from "../../application/script_trust_ports.ts";
import type { InstructionBase } from "../../application/verify_instructions.ts";
import { APPROVALS_FILE } from "../../domain/skill_approvals.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import { findHarness } from "../harnesses.ts";
import { inProject, tempFileWriter, VERIFIER_EXIT } from "./verifier_command.ts";
import type { RecordApprovalsIntent } from "../record_approvals_parser.ts";

/**
 * `specnaut record-approvals --instructions-digest <D> --head <sha> --base-tip <sha>`: what
 * `land-feature.sh` runs after a yes to D, once HEAD is judged. It writes no file of the work tree
 * and makes no commit: the landing commits the file itself, with git's plumbing. The output contract:
 *
 *   0  one `APPROVED <sha256> <path>` line per skill recorded, one `NOT APPROVED <path> <why>` per
 *      skill the yes covered that no approval may hold, then `APPROVALS_FILE <path>` (the whole new
 *      `.specnaut/approved-skills.txt`, in a new temp file outside the repository, which the caller
 *      removes) or `APPROVALS unchanged`
 *   1  D does not hold for HEAD judged at those commits: `APPROVAL instructions moved <digest now>`,
 *      nothing written
 *   2  usage: no `.specnaut/` here; an argument is the parser's exit 2, as is an older binary's
 *      answer to a command it does not know
 *   3  the commits are not ones this repository holds, or the check could not run
 */
const EXIT = { written: 0, moved: 1, ...VERIFIER_EXIT } as const;

type Opened = { git: GitObjectReader; tree: CheckoutTreeWalker };

export type RecordApprovalsDeps = {
  readonly cwd: string;
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly open: (cwd: string) => Promise<Opened>;
  readonly writeFile: (text: string) => Promise<string>;
};

function defaultDeps(): RecordApprovalsDeps {
  return {
    cwd: Deno.cwd(),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    open: async (cwd) => ({
      git: await GitObjects.open(cwd),
      tree: new FsTreeWalker(cwd, "block"),
    }),
    writeFile: tempFileWriter("specnaut-approvals-"),
  };
}

export async function runRecordApprovals(
  intent: RecordApprovalsIntent,
  deps: RecordApprovalsDeps = defaultDeps(),
): Promise<number> {
  return await inProject(deps.cwd, (code, why) => refuse(deps, code, why), async () => {
    const { git, tree } = await deps.open(deps.cwd);
    const base = await baseOf(git, intent);
    if (typeof base === "string") return refuse(deps, EXIT.couldNotRun, base);
    const judge = { git, tree, core: CORE_BUNDLE, findHarness };
    return await report(deps, await recordApprovals(judge, base, intent.digest));
  });
}

/** The commits named, each as this repository holds it, and their merge base; or why not. */
async function baseOf(git: GitObjectReader, intent: RecordApprovalsIntent) {
  if (await git.commitOf(intent.head) !== intent.head) return "--head names no commit here";
  if (await git.commitOf(intent.baseTip) !== intent.baseTip) {
    return "--base-tip names no commit here";
  }
  const mergeBase = await git.mergeBase(intent.head, intent.baseTip);
  if (mergeBase === null) return "--head shares no history with --base-tip";
  return { tip: intent.baseTip, mergeBase, head: intent.head } satisfies InstructionBase;
}

async function report(deps: RecordApprovalsDeps, outcome: RecordOutcome): Promise<number> {
  if (outcome.kind === "moved") {
    deps.out(`APPROVAL instructions moved ${outcome.digest}`);
    deps.err(
      red("error: specnaut record-approvals: the yes does not hold for HEAD: nothing written"),
    );
    return EXIT.moved;
  }
  if (outcome.unread !== null) {
    const why = `HEAD's ${APPROVALS_FILE} is not read, so it is written whole: ${outcome.unread}`;
    deps.err(yellow(`warning: specnaut record-approvals: ${terminalText(why)}`));
  }
  deps.out((await recordedLines(deps, outcome)).join("\n"));
  return EXIT.written;
}

/** Exit 0's lines, in the order the header gives; the new file is written on the way. */
async function recordedLines(
  deps: RecordApprovalsDeps,
  outcome: Extract<RecordOutcome, { kind: "recorded" }>,
): Promise<string[]> {
  const file = outcome.text === null ? null : await deps.writeFile(outcome.text);
  return [
    ...outcome.approved.map((a) => `APPROVED ${a.sha256} ${terminalText(a.path)}`),
    ...outcome.refused.map((r) => `NOT APPROVED ${terminalText(r.path)} ${r.why}`),
    file === null ? "APPROVALS unchanged" : `APPROVALS_FILE ${terminalText(file)}`,
  ];
}

function refuse(deps: RecordApprovalsDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut record-approvals: ${terminalText(why)}`));
  return code;
}
