import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Hermetic test for the enriched `log-subagent.sh` hook (#381 mechanism C,
 * re-anchored in #388 to the empirically-captured real Claude Code payload).
 *
 * The hook is the deterministic data foundation of the status ledger. The real
 * `SubagentStop` payload (captured live, see research.md) names the agent under
 * `agent_type` and carries the agent's end-of-turn contract blocks under
 * `last_assistant_message` — NOT the `agent_name`/`output` keys the original
 * #381 hook (and its test) assumed. That mismatch is why the ledger shipped
 * inert (`agent:"unknown"`, zero contract fields). These cases are therefore
 * anchored to the REAL shape; the legacy keys are kept only as explicit
 * fallback cases.
 *
 * The hook parses the OPTIONAL contract fields (`state`, `done_criteria_met`,
 * `handoff_target`, `review_verdict`, `qa_verdict`) plus the optional
 * `agent_id`/`effort` context out of the payload and appends them as JSONL keys
 * beside the always-present `{ts, event, session, agent}`. The contract blocks
 * use canonical UPPERCASE field names (`STATE:` / `REVIEW_VERDICT:` …) per the
 * #378 contract; the hook matches them case-insensitively.
 *
 * Each case pipes a synthetic stop-event payload into the hook against a temp
 * cwd (so the hook writes `<temp>/.specnaut/logs/agents.jsonl`) and asserts the
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
  const cwd = await Deno.makeTempDir({ prefix: "specnaut-log-subagent-" });
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
      const log = await Deno.readTextFile(`${cwd}/.specnaut/logs/agents.jsonl`);
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

Deno.test("REAL SubagentStop payload (agent_type + last_assistant_message + UPPERCASE block) → fully enriched line", async () => {
  // Mirrors the empirically-captured shape: name under `agent_type`, contract
  // blocks under `last_assistant_message`, canonical UPPERCASE field names.
  const lastAssistantMessage = [
    "Done with the security pass.",
    "",
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: fail",
    "",
    "WORKFLOW STATUS",
    "STATE: awaiting_review",
    "DONE_CRITERIA_MET: yes",
    "HANDOFF_TARGET: review-coordinator",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-123",
    agent_id: "abf05f10d169e18fa",
    agent_type: "security-auditor",
    effort: { level: "high" },
    permission_mode: "bypassPermissions",
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    last_assistant_message: lastAssistantMessage,
    background_tasks: [],
    session_crons: [],
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line, "expected an appended JSONL line");
  assertEquals(line.event, "stop");
  assertEquals(line.session, "sess-123");
  // Name resolved from `agent_type` (not the absent `agent_name`).
  assertEquals(line.agent, "security-auditor");
  // Optional context fields populated from the real payload.
  assertEquals(line.agent_id, "abf05f10d169e18fa");
  assertEquals(line.effort, "high");
  // Contract fields parsed from `last_assistant_message`, UPPERCASE names.
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

Deno.test("agent_id / effort omitted when absent from the payload", async () => {
  const payload = JSON.stringify({
    session_id: "sess-no-ctx",
    agent_type: "developer",
    last_assistant_message: "Just prose, no contract block.",
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.agent, "developer");
  assert(!("agent_id" in line), "agent_id must be omitted when absent");
  assert(!("effort" in line), "effort must be omitted when absent");
});

Deno.test("legacy `.output` key + `agent_name` still probed (version-drift fallback)", async () => {
  // Older/alternate payload shapes used `agent_name` + `output`. The hook keeps
  // these as fallbacks behind the real `agent_type` / `last_assistant_message`.
  const output = [
    "WORKFLOW STATUS",
    "STATE: blocked",
    "DONE_CRITERIA_MET: no",
    "HANDOFF_TARGET: none",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-legacy",
    agent_name: "developer",
    output,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.agent, "developer");
  assertEquals(line.state, "blocked");
  assertEquals(line.done_criteria_met, "no");
  assertEquals(line.handoff_target, "none");
});

Deno.test("lowercase contract field names are still captured (case-insensitive match)", async () => {
  // Defensive: even if an agent emits lowercase field names, the hook's
  // case-insensitive grep must still populate the ledger.
  const lastAssistantMessage = [
    "Ran the smoke pass.",
    "",
    "WORKFLOW STATUS",
    "state: done",
    "done_criteria_met: yes",
    "handoff_target: none",
    "",
    "QA SUMMARY",
    "qa_verdict: pass",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-lower",
    agent_type: "qa-tester",
    last_assistant_message: lastAssistantMessage,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.agent, "qa-tester");
  assertEquals(line.state, "done");
  assertEquals(line.done_criteria_met, "yes");
  assertEquals(line.handoff_target, "none");
  assertEquals(line.qa_verdict, "pass");
  assert(!("review_verdict" in line), "review_verdict must be omitted");
});

Deno.test("dual block REVIEW_VERDICT:fail + QA_VERDICT:pass → each verdict bound to its own block", async () => {
  // Dual-block payload: the review block fails, the QA block passes. The hook
  // must SEGMENT the output per block so each verdict is read only within its
  // own block — never cross-contaminated. With distinct UPPERCASE names
  // (REVIEW_VERDICT vs QA_VERDICT) the segmentation is belt-and-suspenders.
  const lastAssistantMessage = [
    "Wrapping up.",
    "",
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: fail",
    "",
    "QA SUMMARY",
    "QA_VERDICT: pass",
    "",
    "WORKFLOW STATUS",
    "STATE: awaiting_review",
    "DONE_CRITERIA_MET: no",
    "HANDOFF_TARGET: review-coordinator",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-dual",
    agent_type: "review-coordinator",
    last_assistant_message: lastAssistantMessage,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.review_verdict, "fail");
  assertEquals(line.qa_verdict, "pass");
  assertEquals(line.state, "awaiting_review");
});

Deno.test("segmentation is load-bearing: a QA_VERDICT line inside the REVIEW block (no QA SUMMARY header) is NOT captured", async () => {
  // This case fails if per-block segmentation is removed. A stray `QA_VERDICT:`
  // line sits INSIDE the REVIEW SUMMARY block and there is NO `QA SUMMARY`
  // header at all. Correct behaviour: the QA segment is empty, so `qa_verdict`
  // is omitted; `review_verdict` is still read from its own block. A naive
  // whole-output grep would wrongly capture `qa_verdict: blocked` here — so this
  // proves the segmentation, not just the distinct field names, is doing work.
  const lastAssistantMessage = [
    "Review only — no QA was run.",
    "",
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: fail",
    "QA_VERDICT: blocked", // stray, inside the REVIEW block, no QA SUMMARY header
    "",
    "WORKFLOW STATUS",
    "STATE: awaiting_review",
    "DONE_CRITERIA_MET: no",
    "HANDOFF_TARGET: developer",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-seg",
    agent_type: "code-reviewer",
    last_assistant_message: lastAssistantMessage,
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.review_verdict, "fail");
  // No QA SUMMARY block → qa_verdict MUST be absent (omit-if-absent), NOT "blocked".
  assertEquals(line.qa_verdict, undefined);
  assertEquals(line.state, "awaiting_review");
});

Deno.test("contract block under the legacy `.result` key is still parsed (output-source fallback rung)", async () => {
  // Older Claude Code versions carried the agent's output under `.result`
  // instead of `.last_assistant_message`. With `last_assistant_message` absent,
  // the hook must fall through the chain (.last_assistant_message → .output →
  // .result → …) and still extract the block from `.result`.
  const resultText = [
    "Audit complete.",
    "",
    "REVIEW SUMMARY",
    "REVIEW_VERDICT: needs_followup",
    "",
    "WORKFLOW STATUS",
    "STATE: awaiting_qa",
    "DONE_CRITERIA_MET: yes",
    "HANDOFF_TARGET: qa-tester",
  ].join("\n");
  const payload = JSON.stringify({
    session_id: "sess-result",
    agent_type: "architecture-auditor",
    result: resultText, // no last_assistant_message / output
  });

  const { code, line } = await runHook("stop", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.agent, "architecture-auditor");
  assertEquals(line.review_verdict, "needs_followup");
  assertEquals(line.state, "awaiting_qa");
  assertEquals(line.handoff_target, "qa-tester");
});

Deno.test("JSON injection via session_id is neutralised → valid JSON, no injected key", async () => {
  // A hostile session_id carrying JSON-special characters (`"` and `:`) must
  // not break the JSONL line or inject extra keys — jq --arg must quote it.
  const hostile = 'sess","injected":"x';
  const payload = JSON.stringify({
    session_id: hostile,
    agent_type: "developer",
    last_assistant_message: "Just prose, no contract block.",
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
    agent_type: "developer",
    last_assistant_message: "Just some prose with no WORKFLOW STATUS block.",
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
  // Exactly the four base keys (agent_id/effort absent here too).
  assertEquals(Object.keys(line).sort(), ["agent", "event", "session", "ts"]);
});

Deno.test("start event → base line, never enriched", async () => {
  // SubagentStart carries no last_assistant_message/effort; never enriched.
  const payload = JSON.stringify({
    session_id: "sess-start",
    agent_id: "abf05f10d169e18fa",
    agent_type: "general-purpose",
    hook_event_name: "SubagentStart",
  });

  const { code, line } = await runHook("start", payload);
  assertEquals(code, 0);
  assert(line);
  assertEquals(line.event, "start");
  assertEquals(line.agent, "general-purpose");
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
