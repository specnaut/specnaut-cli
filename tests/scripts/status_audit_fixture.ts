import { fromFileUrl, join } from "@std/path";
import { bashPath, type Run, type Sandbox, sandbox } from "../templates/hooks/hook_sandbox.ts";

/**
 * The project sandbox the `status-audit.sh` behaviour tests share (cli#679):
 * a temp project with its own `.specnaut/logs/agents.jsonl`, and the real
 * script run on it by `bash` — never a reimplementation of a view.
 */

export const SCRIPT = fromFileUrl(
  new URL("../../templates/core/skills/status-audit/scripts/status-audit.sh", import.meta.url),
);

/** An ISO-8601 UTC timestamp `minutes` before now, in the hook's own format. */
export function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface Project {
  sb: Sandbox;
  dir: string;
  /** Run the script in the project with `args`; `env` overrides the sandbox's. */
  run(args?: string[], env?: Record<string, string>): Promise<Run>;
  cleanup(): Promise<void>;
}

/** A project whose ledger holds `lines` verbatim — `null` means no ledger at all. */
export async function project(lines: string[] | null): Promise<Project> {
  const sb = await sandbox();
  const dir = join(sb.dir, "project");
  await Deno.mkdir(join(dir, ".specnaut/logs"), { recursive: true });
  if (lines !== null) {
    await Deno.writeTextFile(join(dir, ".specnaut/logs/agents.jsonl"), lines.join("\n") + "\n");
  }
  return {
    sb,
    dir,
    async run(args = [], env = {}) {
      const out = await new Deno.Command("bash", {
        args: [bashPath(SCRIPT), ...args],
        cwd: dir,
        env: { ...sb.env, ...env },
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
    },
    cleanup: () => sb.cleanup(),
  };
}

/** One ledger line, as `log-subagent.sh` writes it. */
export function line(fields: Record<string, unknown>): string {
  return JSON.stringify({ event: "stop", session: "s1", ...fields });
}

/**
 * The text of view `n` — from its `n. ` heading to the next heading — so an
 * assertion about one view cannot be satisfied by another view's row.
 */
export function view(out: string, n: number): string {
  const start = out.search(new RegExp(`^${n}\\. `, "m"));
  if (start < 0) throw new Error(`no view ${n} in:\n${out}`);
  const rest = out.slice(start);
  const next = rest.slice(1).search(/^[1-7]\. /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/**
 * A healthy-looking session with one of each signal: a stale developer, a
 * blocked security seat, a false completion, a dropped baton and a kept one.
 * The developer's lines are deliberately out of `ts` order in the file.
 */
export function normalLedger(): string[] {
  return [
    line({ ts: ago(30), agent: "developer", state: "in_progress" }),
    line({ ts: ago(40), event: "start", agent: "developer" }),
    line({
      ts: ago(1),
      agent: "architect-expert",
      state: "done",
      done_criteria_met: "yes",
      review_verdict: "pass",
    }),
    line({
      ts: ago(2),
      agent: "security-expert",
      state: "blocked",
      review_verdict: "needs_followup",
    }),
    line({
      ts: ago(3),
      agent: "qa-tester",
      state: "done",
      done_criteria_met: "no",
      qa_verdict: "fail",
    }),
    line({
      ts: ago(5),
      agent: "product-owner",
      state: "awaiting_user",
      handoff_target: "code-reviewer",
    }),
    line({
      ts: ago(4),
      agent: "performance-expert",
      state: "awaiting_review",
      handoff_target: "architect-expert",
    }),
    line({
      ts: ago(2),
      session: "s2",
      agent: "dependency-expert",
      state: "done",
      review_verdict: "fail",
    }),
  ];
}
