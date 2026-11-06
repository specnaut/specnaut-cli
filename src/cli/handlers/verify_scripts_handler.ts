import { red } from "@std/fmt/colors";
import { type VerifyOutcome, verifyScripts } from "../../application/verify_scripts.ts";
import type { GitObjectReader, ScriptTreeWalker } from "../../application/script_trust_ports.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsScriptTreeWalker } from "../../infrastructure/fs_script_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import { findHarness } from "../harnesses.ts";

/**
 * `specnaut verify-scripts`: the review and the merge run it before any helper script of the
 * tree, and act on its answer. The exit code and the output contract live here:
 *
 *   0  trusted: every file under `.specnaut/scripts/` matches a copy the branch does not carry
 *   1  untrusted: one `UNTRUSTED <path> <reason>` line per cause
 *   2  usage: an argument (the parser's), or no `.specnaut/` in the folder it runs in
 *   3  the base is unknown, or the check could not run
 *
 * Exits 0 and 1 print, in order, `BASE <merge-base sha>`, `BASE_TIP <sha>`, `BASE_BRANCH <name>`,
 * `NAMES_FILE <path>` (the paths changed since BASE, one per line, in a new temp file outside the
 * repository), the `UNTRUSTED` lines, and last `VERDICT scripts trusted|untrusted`. Every other
 * exit ends with `VERDICT scripts untrusted` too. A caller trusts the scripts only on exit 0 with
 * that final `trusted` line and a full `BASE` sha; anything else, the binary missing included, is
 * untrusted. `scripts` names the class checked, so others can be added without breaking a caller.
 */
const EXIT = { trusted: 0, untrusted: 1, usage: 2, couldNotRun: 3 } as const;
const UNTRUSTED = "VERDICT scripts untrusted";

export type VerifyScriptsDeps = {
  readonly cwd: string;
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly open: (cwd: string) => Promise<{ git: GitObjectReader; walker: ScriptTreeWalker }>;
  readonly writeNames: (names: Uint8Array) => Promise<string>;
};

function defaultDeps(): VerifyScriptsDeps {
  return {
    cwd: Deno.cwd(),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    open: async (cwd) => ({ git: await GitObjects.open(cwd), walker: new FsScriptTreeWalker(cwd) }),
    writeNames: async (names) => {
      const path = await Deno.makeTempFile({ prefix: "specnaut-names-" });
      await Deno.writeFile(path, names);
      return path;
    },
  };
}

export async function runVerifyScripts(deps: VerifyScriptsDeps = defaultDeps()): Promise<number> {
  if (!await exists(`${deps.cwd}/.specnaut`)) {
    return refuse(deps, EXIT.usage, "no .specnaut/ here: run it from the project's root");
  }
  try {
    const { git, walker } = await deps.open(deps.cwd);
    const outcome = await verifyScripts({ git, walker, core: CORE_BUNDLE, findHarness });
    return await answer(outcome, deps);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return refuse(deps, EXIT.couldNotRun, `the check could not run: ${why}`);
  }
}

async function answer(outcome: VerifyOutcome, deps: VerifyScriptsDeps): Promise<number> {
  if (outcome.kind === "base_unknown") {
    return refuse(deps, EXIT.couldNotRun, `the base is unknown: ${outcome.why}`);
  }
  const lines = [
    `BASE ${outcome.base}`,
    `BASE_TIP ${outcome.baseTip}`,
    `BASE_BRANCH ${outcome.baseBranch}`,
    `NAMES_FILE ${terminalText(await deps.writeNames(outcome.names))}`,
    ...outcome.verdict.untrusted.map((u) =>
      `UNTRUSTED ${terminalText(u.path)} ${terminalText(u.reason)}`
    ),
    outcome.verdict.trusted ? "VERDICT scripts trusted" : UNTRUSTED,
  ];
  deps.out(lines.join("\n"));
  return outcome.verdict.trusted ? EXIT.trusted : EXIT.untrusted;
}

function refuse(deps: VerifyScriptsDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut verify-scripts: ${terminalText(why)}`));
  deps.out(UNTRUSTED);
  return code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
