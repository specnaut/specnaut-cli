import { red, yellow } from "@std/fmt/colors";
import { runStructuralScan, type ScanOutcome } from "../../application/run_structural_scan.ts";
import type { ScanRepository } from "../../application/structural_scan_ports.ts";
import type { ScanReport } from "../../domain/structural_scan_types.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { openGitRepository } from "../../infrastructure/git_tracked_files.ts";
import type { ScanIntent } from "../intent.ts";
import { renderScan } from "../scan_render.ts";

/**
 * `specnaut scan` (#747): wires the use case to the git adapter, and maps its outcome to an exit
 * code. That mapping lives here and nowhere else (plan A9):
 *
 *   0  a map, and no file over its ceiling
 *   1  a map, and a file over its ceiling
 *   2  a `--path` that matches no tracked file (other usage errors are the parser's, exit 2 too)
 *   3  no map: not a git work tree, an unreadable config or lock, a refused root, or any
 *      unexpected error. Exit 1 must only ever mean "over a ceiling" (plan A4), so a crash is
 *      caught here and never left to `main.ts`.
 *
 * An estimated finding, a function or a class over its limit, never changes the code.
 */
const SCAN_EXIT = { map: 0, overCeiling: 1, usage: 2, couldNotRun: 3 } as const;

export type ScanDeps = {
  readonly cwd: string;
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly open: (cwd: string, warn: (message: string) => void) => Promise<ScanRepository>;
};

function defaultDeps(): ScanDeps {
  return {
    cwd: Deno.cwd(),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    open: openGitRepository,
  };
}

/** Only a measured file over its ceiling fails: the constitution counts, an estimate does not. */
function exitCodeOf(report: ScanReport): number {
  const { file, constitution } = report.totals.over;
  return file.over_ceiling + constitution.over_ceiling > 0 ? SCAN_EXIT.overCeiling : SCAN_EXIT.map;
}

export async function runScan(intent: ScanIntent, deps: ScanDeps = defaultDeps()): Promise<number> {
  try {
    const warn = (m: string) => deps.err(yellow(`warning: ${terminalText(m)}`));
    const repo = await deps.open(deps.cwd, warn);
    const top = intent.top === "all" ? null : intent.top;
    return answer(await runStructuralScan(repo, { path: intent.path, top }), intent, deps);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    deps.err(red(`error: specnaut scan could not run: ${terminalText(why)}`));
    return SCAN_EXIT.couldNotRun;
  }
}

function answer(outcome: ScanOutcome, intent: ScanIntent, deps: ScanDeps): number {
  if (outcome.kind === "report") {
    deps.out(renderScan(outcome.report, intent.format));
    return exitCodeOf(outcome.report);
  }
  if (outcome.kind === "no_match") {
    deps.err(red(`error: --path ${terminalText(intent.path ?? "")} matches no tracked file`));
    return SCAN_EXIT.usage;
  }
  deps.err(red(`error: ${outcome.what} is unreadable (${terminalText(outcome.reason)}); no map`));
  return SCAN_EXIT.couldNotRun;
}
