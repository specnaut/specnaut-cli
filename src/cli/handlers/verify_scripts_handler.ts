import { red } from "@std/fmt/colors";
import { type VerifyOutcome, verifyScripts } from "../../application/verify_scripts.ts";
import { verifyConfig } from "../../application/verify_config.ts";
import { type InstructionBase, verifyInstructions } from "../../application/verify_instructions.ts";
import { shippedSkills } from "../../application/shipped_copies.ts";
import type {
  CheckoutTreeWalker,
  GitObjectReader,
  ScriptTreeWalker,
} from "../../application/script_trust_ports.ts";
import type { ConfigVerdict } from "../../domain/config_trust.ts";
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

export async function runVerifyScripts(deps: VerifyScriptsDeps = defaultDeps()): Promise<number> {
  try {
    if (!await fileExists(`${deps.cwd}/.specnaut`)) {
      return refuse(deps, EXIT.usage, "no .specnaut/ here: run it from the project's root");
    }
    const { git, walker, config } = await deps.open(deps.cwd);
    const outcome = await verifyScripts({ git, walker, core: CORE_BUNDLE, findHarness });
    const base = outcome.kind === "judged"
      ? { tip: outcome.baseTip, mergeBase: outcome.base, head: outcome.head }
      : null;
    return await answer(outcome, await judgeInputs(git, config, base), deps);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return refuse(deps, EXIT.couldNotRun, `the check could not run: ${why}`);
  }
}

/** The config and instruction lines, and the digest a yes to the instruction lines covers. */
type Judged = { readonly verdicts: readonly ConfigVerdict[]; readonly digest: string | null };

/** The config, then the instruction verdicts, measured from `base`; none when it is unknown. */
async function judgeInputs(
  git: GitObjectReader,
  tree: CheckoutTreeWalker,
  base: InstructionBase | null,
): Promise<Judged> {
  if (base === null) return { verdicts: [], digest: null };
  const config = await verifyConfig({ git, tree }, base);
  const shipped = await shippedSkills({ git, core: CORE_BUNDLE, findHarness }, base.tip);
  const instructions = await verifyInstructions({ git, tree }, base, shipped);
  return { verdicts: [...config, ...instructions.verdicts], digest: instructions.digest };
}

async function answer(
  outcome: VerifyOutcome,
  config: Judged,
  deps: VerifyScriptsDeps,
): Promise<number> {
  if (outcome.kind === "base_unknown") {
    return refuse(deps, EXIT.couldNotRun, `the base is unknown: ${outcome.why}`);
  }
  const names = outcome.names.map((n) => `${terminalText(n)}\n`).join("");
  deps.out(reportLines(outcome, config, await deps.writeNames(names)).join("\n"));
  return outcome.verdict.trusted ? EXIT.trusted : EXIT.untrusted;
}

/** Exits 0 and 1's lines, in the order the header gives. */
function reportLines(
  outcome: Extract<VerifyOutcome, { kind: "judged" }>,
  config: Judged,
  namesFile: string,
): string[] {
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
    outcome.verdict.trusted ? "VERDICT scripts trusted" : UNTRUSTED,
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
