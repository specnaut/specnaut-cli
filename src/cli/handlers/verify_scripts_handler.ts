import { red, yellow } from "@std/fmt/colors";
import { type VerifyOutcome, verifyScripts } from "../../application/verify_scripts.ts";
import { instructionsNow, type Judged, judgeInputs } from "../../application/judge_inputs.ts";
import type {
  CheckoutTreeWalker,
  GitObjectReader,
  ScriptTreeWalker,
} from "../../application/script_trust_ports.ts";
import {
  type ApprovalLine,
  type ApprovalVerdict,
  approvalVerdict,
  type ApprovedDigests,
  scriptsApprovable,
} from "../../domain/approval_verdict.ts";
import type { ConfigVerdict } from "../../domain/config_trust.ts";
import { APPROVALS_FILE } from "../../domain/skill_approvals.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { fileExists } from "../../infrastructure/fs_backup.ts";
import { FsScriptTreeWalker } from "../../infrastructure/fs_script_tree_walker.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import { findHarness } from "../harnesses.ts";

/**
 * `specnaut verify-scripts`: the review and the merge run it before any helper script of the
 * tree, and act on its answer. The exit code and the output contract live here:
 *
 *   0  trusted: every file under `.specnaut/scripts/` matches a copy the branch does not carry
 *   1  untrusted: one `UNTRUSTED <path> <reason>` line per cause
 *   2  usage: no `.specnaut/` in the folder it runs in. An argument is exit 2 too, but the parser's
 *      (`main.ts`): it refuses before this handler runs, help on stderr and no `VERDICT` line
 *   3  the base is unknown, or the check could not run
 *
 * Exits 0 and 1 print, in order, `BASE <merge-base sha>`, `BASE_TIP <sha>`, `BASE_BRANCH <name>`,
 * `NAMES_FILE <path>` (the paths changed since BASE, one per line, in a new temp file outside the
 * repository, which the caller removes once read), `NAMES_RELATIVE_TO <folder>` (those paths are
 * relative to the project's folder, named from the repository's top, `.` at the top),
 * `SCRIPTS_DIGEST <sha256>` (the folder's bytes as walked: what a user's approval covers),
 * `INSTRUCTIONS_DIGEST <sha256>` (the instruction files as HEAD commits them and the reasons the
 * `instructions` lines show: what a yes to them covers, `headDigest` in `script_digest.ts`), one
 * `VERDICT <class> trusted` or `VERDICT <class> untrusted <path> <reason>` per config input a
 * branch controls (`config_trust.ts`: the tree's value against BASE_TIP's; the exit does not count
 * them), then `VERDICT instructions trusted` or one `VERDICT instructions untrusted <path> <reason>`
 * per path the instruction class names (`instruction_trust.ts`: a path whose work tree or HEAD
 * entry is not the tip's, whose work tree is not HEAD's, a skill Specnaut ships whose HEAD bytes
 * are not the shipped copy, `shipped_skills.ts`, or a file a judged CLAUDE.md imports,
 * `claude_imports.ts`), the `UNTRUSTED` lines, and last
 * `VERDICT scripts trusted|untrusted`. A class with no `trusted` line, on any exit, is untrusted.
 * Every other exit of this handler, a crash included, ends with `VERDICT scripts untrusted` too. A
 * caller trusts the scripts only on exit 0 with that final `trusted` line and a full `BASE` sha;
 * anything else, the binary missing included, is untrusted. `scripts` names the class checked, so
 * others can be added without breaking a caller.
 *
 * `--approved-scripts <sha256>` and `--approved-instructions <sha256>` name the digests a user's
 * yes covers (the merge phase after a yes, and `land-feature.sh`). With either, one line per
 * flagged class, `APPROVAL <class> holds <digest>` or `APPROVAL <class> moved <digest>` (the digest
 * computed now; a scripts reason outside `.specnaut/scripts/` is never held), comes right before
 * the last line, and exits 0 and 1 change meaning: 0 when the scripts and the instructions are each
 * trusted or held, 1 otherwise. Exit 0 then means binding, not consent: the tree is the one the
 * digest named. The last line still reads `trusted` only for scripts that really are.
 */
const EXIT = { trusted: 0, untrusted: 1, usage: 2, couldNotRun: 3 } as const;
const UNTRUSTED = "VERDICT scripts untrusted";

type Opened = { git: GitObjectReader; walker: ScriptTreeWalker; config: CheckoutTreeWalker };

export type VerifyScriptsDeps = {
  readonly cwd: string;
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly open: (cwd: string) => Promise<Opened>;
  readonly writeNames: (names: string) => Promise<string>;
};

function defaultDeps(): VerifyScriptsDeps {
  return {
    cwd: Deno.cwd(),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    open: async (cwd) => ({
      git: await GitObjects.open(cwd),
      walker: new FsScriptTreeWalker(cwd),
      config: new FsTreeWalker(cwd, "block"),
    }),
    writeNames: async (names) => {
      const path = await Deno.makeTempFile({ prefix: "specnaut-names-" });
      await Deno.writeTextFile(path, names);
      return path;
    },
  };
}

export async function runVerifyScripts(
  deps: VerifyScriptsDeps = defaultDeps(),
  approved: ApprovedDigests = {},
): Promise<number> {
  try {
    if (!await fileExists(`${deps.cwd}/.specnaut`)) {
      return refuse(deps, EXIT.usage, "no .specnaut/ here: run it from the project's root");
    }
    const { git, walker, config } = await deps.open(deps.cwd);
    const outcome = await verifyScripts({ git, walker, core: CORE_BUNDLE, findHarness });
    const base = outcome.kind === "judged"
      ? { tip: outcome.baseTip, mergeBase: outcome.base, head: outcome.head }
      : null;
    const judged = await judgeInputs({ git, tree: config, core: CORE_BUNDLE, findHarness }, base);
    warnRefused(deps, judged);
    return await answer(outcome, judged, deps, approved);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return refuse(deps, EXIT.couldNotRun, `the check could not run: ${why}`);
  }
}

/**
 * The approvals at the base's tip, when they could not be read: said on stderr, never a verdict
 * line. They approve nothing then, so each customised skill is named and asked about.
 */
function warnRefused(deps: VerifyScriptsDeps, judged: Judged): void {
  const why = judged.shipped?.approvalsRefused;
  if (why === null || why === undefined) return;
  const text = `${APPROVALS_FILE} at the base's tip is not read, so it approves nothing: ${why}`;
  deps.err(yellow(`warning: specnaut verify-scripts: ${terminalText(text)}`));
}

type Outcome = Extract<VerifyOutcome, { kind: "judged" }>;

async function answer(
  outcome: VerifyOutcome,
  config: Judged,
  deps: VerifyScriptsDeps,
  approved: ApprovedDigests,
): Promise<number> {
  if (outcome.kind === "base_unknown") {
    return refuse(deps, EXIT.couldNotRun, `the base is unknown: ${outcome.why}`);
  }
  const names = outcome.names.map((n) => `${terminalText(n)}\n`).join("");
  const approval = Object.keys(approved).length === 0
    ? null
    : approvalOf(outcome, config, approved);
  const lines = reportLines(outcome, config, await deps.writeNames(names));
  const last = outcome.verdict.trusted ? "VERDICT scripts trusted" : UNTRUSTED;
  deps.out([...lines, ...(approval?.lines ?? []).map(approvalLine), last].join("\n"));
  return (approval?.holds ?? outcome.verdict.trusted) ? EXIT.trusted : EXIT.untrusted;
}

/** The yes's verdict on the scripts and the instructions as judged now. */
function approvalOf(outcome: Outcome, config: Judged, approved: ApprovedDigests): ApprovalVerdict {
  const { trusted, untrusted } = outcome.verdict;
  return approvalVerdict(approved, {
    scripts: { trusted, digest: outcome.digest, approvable: scriptsApprovable(untrusted) },
    instructions: instructionsNow(config),
  });
}

function approvalLine(l: ApprovalLine): string {
  return `APPROVAL ${l.class} ${l.holds ? "holds" : "moved"} ${l.digest}`;
}

/** Exits 0 and 1's lines, in the order the header gives, up to the approval and last lines. */
function reportLines(outcome: Outcome, config: Judged, namesFile: string): string[] {
  return [
    `BASE ${outcome.base}`,
    `BASE_TIP ${outcome.baseTip}`,
    `BASE_BRANCH ${outcome.baseBranch}`,
    `NAMES_FILE ${terminalText(namesFile)}`,
    `NAMES_RELATIVE_TO ${terminalText(outcome.namesRelativeTo)}`,
    `SCRIPTS_DIGEST ${outcome.digest}`,
    ...config.digest === null ? [] : [`INSTRUCTIONS_DIGEST ${config.digest}`],
    ...config.verdicts.map(configLine),
    ...outcome.verdict.untrusted.map((u) =>
      `UNTRUSTED ${terminalText(u.path)} ${terminalText(u.reason)}`
    ),
  ];
}

function configLine(v: ConfigVerdict): string {
  if (v.trusted) return `VERDICT ${v.class} trusted`;
  return `VERDICT ${v.class} untrusted ${terminalText(v.path)} ${terminalText(v.reason)}`;
}

function refuse(deps: VerifyScriptsDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut verify-scripts: ${terminalText(why)}`));
  deps.out(UNTRUSTED);
  return code;
}
