import { type Harness, payload, type Run, runHook, type Sandbox } from "./hook_sandbox.ts";

/**
 * What the guard-merge tests share: how one Bash call is fed to the real
 * guard, and how its answer is read. Nothing here reimplements a guard rule.
 */

export type Verdict = "allow" | "ask" | "deny";

/**
 * What only guard-merge's deny path prints: approval_gate's refusal, naming
 * the base and the word to type. Every crash exits 2 too — the ERR trap, a bad
 * payload, a missing list — so an exit code alone would read a crash as a
 * deny, and a test of a deny would pass on a guard that never reached its rule
 * (cli#711).
 */
const DENY =
  /^specnaut guard-merge: merge: manual — .+ would land on the base branch .+ To let it through, reply /;

/** The guard's answer, as each harness sees it — or what went wrong. */
export function verdict(r: Run): Verdict | string {
  if (r.code === 2 && DENY.test(r.stderr)) return "deny";
  if (r.code === 0 && r.stdout === "") return "allow";
  if (r.code === 0 && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "ask") {
    return "ask";
  }
  return `unexpected exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

/** Runs guard-merge.sh on a Bash call of `command`, made in `repo`. */
export async function bash(
  sb: Sandbox,
  harness: Harness,
  repo: string,
  command: string,
  extra: Record<string, unknown> = {},
): Promise<Run> {
  const p = await payload(harness, "pre_tool_use_bash", {
    cwd: repo,
    tool_input: { command },
    ...extra,
  });
  return runHook(sb, "guard-merge.sh", harness, p);
}

/** What a gated command yields when nothing approved it. */
export const GATED: Record<Harness, Verdict> = { claude: "ask", codex: "deny" };
