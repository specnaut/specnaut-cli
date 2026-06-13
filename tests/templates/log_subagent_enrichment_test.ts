import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Hermetic test for the enriched `log-subagent.sh` hook (#381, mechanism C).
 *
 * The hook is the deterministic data foundation of the status ledger: it parses
 * the OPTIONAL contract fields (`state`, `done_criteria_met`, `handoff_target`,
 * `review_verdict`, `qa_verdict`) out of the subagent's output text and appends
 * them as JSONL keys beside the always-present `{ts, event, session, agent}`.
 *
 * Each case pipes a synthetic stop-event payload into the hook against a temp
 * cwd (so the hook writes `<temp>/.specflow/logs/agents.jsonl`) and asserts the
 * shape of the appended line. The hook MUST stay backward-compatible
 * (omit-if-absent — never emit an empty contract key) and MUST always exit 0.
 */

const HOOK = fromFileUrl(
  new URL(
    "../../templates/harness-specific/claude/hooks/log-subagent.sh",
    import.meta.url,
  ),
);

interface HookRun {
  code: number;
  /** The single JSONL line the hook appended (parsed), or undefined if none. */
  line: Record<string, unknown> | undefined;
  rawLines: string[];
}

/** Run the hook with `event` and `payload` on stdin against a fresh temp cwd. */
async function runHook(event: string, payload: string): Promise<HookRun> {
  const cwd = await Deno.makeTempDir({ prefix: "specflow-log-subagent-" });
  try {
    const p = new Deno.Command("bash", {
      args: [HOOK, event],
      cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = p.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(payload));
    await writer.close();
    const { code } = await child.output();

    let rawLines: string[] = [];
    try {
      const log = await Deno.readTextFile(`${cwd}/.specflow/logs/agents.jsonl`);
      rawLines = log.split("\n").filter((l) => l.trim().length > 0);
    } catch {
      // No log file written — leave rawLines empty; assertions handle it.
      rawLines = [];
    }
    const last = rawLines.at(-1);
    return {
      code,
      line: last ? JSON.parse(last) : undefined,
      rawLines,
    };
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
}

const CONTRACT_KEYS = [
  "state",
  "done_criteria_met",
  "handoff_target",
  "review_verdict",
  "qa_verdict",
] as const;

Deno.test("stop payload with WORKFLOW STATUS + REVIEW SUMMARY → enriched line", async () => {
  const output = [
    "Done with the security pass.",
    "",
    "WORKFLOW STATUS",
    "state: awaiting_review",
    "done_criteria_met: yes",
    "handoff_target: review-coordinator",
    "",
    "REVIEW SUMMARY",
    "verdict: fail",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-123",
    agent_name: "security-auditor",
    output,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line, "expected an appended JSONL line");
  assertEquals(line.event, "stop");
  assertEquals(line.session, "sess-123");
  assertEquals(line.agent, "security-auditor");
  assertEquals(line.state, "awaiting_review");
  assertEquals(line.done_criteria_met, "yes");
  assertEquals(line.handoff_target, "review-coordinator");
  assertEquals(line.review_verdict, "fail");
  // QA SUMMARY absent → key omitted, not empty.
  assert(
    !("qa_verdict" in line),
    "qa_verdict must be omitted when no QA SUMMARY block is present",
  );
  assertEquals(typeof line.ts, "string");
});

Deno.test("stop payload with QA SUMMARY → qa_verdict captured", async () => {
  const output = [
    "Ran the smoke pass.",
    "",
    "WORKFLOW STATUS",
    "state: done",
    "done_criteria_met: yes",
    "handoff_target: none",
    "",
    "QA SUMMARY",
    "verdict: pass",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-qa",
    agent_name: "qa-tester",
    output,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.state, "done");
  assertEquals(line.handoff_target, "none");
  assertEquals(line.qa_verdict, "pass");
  assert(!("review_verdict" in line), "review_verdict must be omitted");
});

Deno.test("stop payload with BOTH REVIEW SUMMARY (fail) + QA SUMMARY (pass) → each verdict bound to its own block", async () => {
  // Dual-block payload: the review block fails, the QA block passes. The hook
  // must SEGMENT the output per block so each `verdict:` is read only within
  // its own block — never cross-contaminated by the other block's verdict.
  const output = [
    "Wrapping up.",
    "",
    "WORKFLOW STATUS",
    "state: awaiting_review",
    "done_criteria_met: no",
    "handoff_target: review-coordinator",
    "",
    "REVIEW SUMMARY",
    "verdict: fail",
    "",
    "QA SUMMARY",
    "verdict: pass",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-dual",
    agent_name: "review-coordinator",
    output,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.review_verdict, "fail");
  assertEquals(line.qa_verdict, "pass");
  assertEquals(line.state, "awaiting_review");
});

Deno.test("JSON injection via session_id is neutralised → valid JSON, no injected key", async () => {
  // A hostile session_id carrying JSON-special characters (`"` and `:`) must
  // not break the JSONL line or inject extra keys — jq --arg must quote it.
  const hostile = 'sess","injected":"x';
  const payload = JSON.stringify({
    session_id: hostile,
    agent_name: "developer",
    output: "Just prose, no contract block.",
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line, "the appended line must still parse as valid JSON");
  // The hostile value must land intact inside the `session` string …
  assertEquals(line.session, hostile);
  // … and must NOT have leaked a top-level `injected` key.
  assert(!("injected" in line), "session_id must not inject a top-level key");
  assertEquals(Object.keys(line).sort(), ["agent", "event", "session", "ts"]);
});

Deno.test("stop payload with no contract block → base four-field line only", async () => {
  const payload = JSON.stringify({
    session_id: "sess-plain",
    agent_name: "developer",
    output: "Just some prose with no WORKFLOW STATUS block at all.",
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.event, "stop");
  assertEquals(line.session, "sess-plain");
  assertEquals(line.agent, "developer");
  // None of the optional contract keys may be present.
  for (const k of CONTRACT_KEYS) {
    assert(!(k in line), `${k} must be omitted when no block is present`);
  }
  // Exactly the four base keys.
  assertEquals(Object.keys(line).sort(), ["agent", "event", "session", "ts"]);
});

Deno.test("start event → base line, never enriched", async () => {
  const payload = JSON.stringify({
    session_id: "sess-start",
    agent_name: "developer",
    output: "WORKFLOW STATUS\nstate: in_progress\ndone_criteria_met: no\nhandoff_target: none",
  });

  const { code, line } = await runHook("start", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.event, "start");
  for (const k of CONTRACT_KEYS) {
    assert(!(k in line), `${k} must be omitted on start events`);
  }
});

Deno.test("empty payload → base line with unknowns, exit 0", async () => {
  const { code, line } = await runHook("stop", "");
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.session, "unknown");
  assertEquals(line.agent, "unknown");
  for (const k of CONTRACT_KEYS) {
    assert(!(k in line), `${k} must be omitted on an empty payload`);
  }
});

Deno.test("malformed/non-JSON payload → never aborts, exit 0, valid base line", async () => {
  const { code, line } = await runHook("stop", "this is not json at all {{{");
  assertEquals(code, 0);
  assert(line, "even a malformed payload must produce a valid base line");
  assertEquals(line.event, "stop");
  assertEquals(typeof line.ts, "string");
});

Deno.test("output under the .result key is also probed", async () => {
  const output = [
    "WORKFLOW STATUS",
    "state: blocked",
    "done_criteria_met: no",
    "handoff_target: none",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-result",
    agent_name: "developer",
    result: output,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.state, "blocked");
  assertEquals(line.done_criteria_met, "no");
});
