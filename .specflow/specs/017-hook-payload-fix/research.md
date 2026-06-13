# Research — real Claude Code hook payload (empirically captured)

## The ground truth (captured 2026-06-13 by instrumenting the live hook + dispatching a subagent)

**SubagentStart**:
```json
{"session_id":"…","transcript_path":"…/<session>.jsonl","cwd":"…","agent_id":"abf05f10d169e18fa","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```

**SubagentStop**:
```json
{"session_id":"…","transcript_path":"…/<session>.jsonl","cwd":"…","permission_mode":"bypassPermissions",
 "agent_id":"abf05f10d169e18fa","agent_type":"general-purpose","effort":{"level":"high"},
 "hook_event_name":"SubagentStop","stop_hook_active":false,
 "agent_transcript_path":"…/subagents/agent-abf05f10d169e18fa.jsonl",
 "last_assistant_message":"PONG","background_tasks":[],"session_crons":[]}
```

## Three confirmed root causes of the inert ledger

| # | Symptom | Hook did | Real key | Fix |
|---|---|---|---|---|
| 1 | `agent: "unknown"` (219/219) | probed `.agent_name`/`.subagent_name`/`.tool_name` | **`agent_type`** | prefer `.agent_type`, keep old fallbacks |
| 2 | zero contract fields | probed `.output`/`.result`/`.response`/`.tool_response`/`.message` | **`last_assistant_message`** | prefer `.last_assistant_message`, keep old fallbacks |
| 3 | (latent) would miss fields even with 1+2 | grepped lowercase `state:`/`verdict:` | canonical **`STATE:`/`REVIEW_VERDICT:`/`QA_VERDICT:`** (uppercase, distinct) | grep canonical names case-insensitively |

## Decisions

1. **Output source = `last_assistant_message`** (the agent's final message, where end-of-turn blocks
   live). No need to read `agent_transcript_path` — simpler and sufficient. Fallback chain kept for
   version drift.
2. **Agent name = `agent_type`** + fallbacks. Also capture **`agent_id`** (optional) — `/status-audit`
   groups by agent, and two concurrent `security-auditor`s share `agent_type` but differ by `agent_id`.
   Capture **`effort.level`** (optional, cheap context).
3. **Field greps = canonical UPPERCASE names, case-insensitive** (`grep -iE 'STATE:…'`,
   `'REVIEW_VERDICT:…'`, `'QA_VERDICT:…'`, `'DONE_CRITERIA_MET:…'`, `'HANDOFF_TARGET:…'`). `REVIEW_VERDICT`
   and `QA_VERDICT` are already distinct names, so cross-contamination is fixed by the names alone;
   per-block segmentation stays as defense-in-depth.
4. **Test fixture = real shape.** The #381 test fed a synthetic `.output`-keyed payload with lowercase
   fields, which is exactly why the bug shipped green. Replace/augment with a `SubagentStop`-shaped
   fixture (`agent_type` + `last_assistant_message` + UPPERCASE block fields), plus a legacy-key case
   and a lowercase-field case for the fallbacks.

## Why the unit tests missed it
The #381 hermetic test asserted enrichment against an ASSUMED payload shape (the keys the hook probed),
so the test and the hook agreed with each other but neither matched reality. The fix's test must be
anchored to the captured real shape (FR-007).
