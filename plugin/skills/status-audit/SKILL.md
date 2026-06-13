---
name: status-audit
description: Read-only health audit of a multi-agent session from the status ledger. Use when the user says "status audit", "audit the session", "how are the agents doing", "what's blocked", "session health", or when supervising long headless work with /loop. Reads .specflow/logs/agents.jsonl, derives each agent's current state from its latest entry, and reports seven health views. Writes nothing.
argument-hint: "[latest|<agent>|<session>]"
---

# Status Audit — read-only session health report

A **thin, read-only** audit of a running (or finished) multi-agent session. It
reads the append-only status ledger at `.specflow/logs/agents.jsonl`, derives
each agent's **current state** (its latest entry by `ts`), and reports seven
health views. It writes **nothing** and mutates **no tracked files** —
`git status` is unchanged after a run.

The ledger is produced by the `log-subagent.sh` hook on every subagent
start/stop. Each line is a JSON object; the schema lives at
`.specflow/logs/README.md`.

## Step 1 — Read the ledger

Read `.specflow/logs/agents.jsonl`.

- **Absent** (file does not exist, or no entries) → report **"no ledger yet —
  no subagents have run in this project, or the `log-subagent.sh` hook is not
  wired."** Stop. This is **not** an error.
- **Present** → parse each line as JSON.
  - A **malformed line** (not parseable JSON) is **skipped with a note**
    (`skipped N malformed line(s)`); every valid line is still processed.
  - An **absent optional field** on an otherwise-valid line is reported as
    **"unknown"** — never an error.

Each line carries the four base fields `ts` / `event` / `session` / `agent` and
the OPTIONAL contract fields `state`, `done_criteria_met`, `handoff_target`,
`review_verdict`, `qa_verdict` (omit-if-absent). Allowed values are in
`.specflow/logs/README.md`.

## Step 2 — Derive current state

The **current state of an agent is its latest entry by `ts`.** Group entries by
`agent`; within each group keep the entry with the maximum `ts`. Optional scope:

- `/status-audit` or `/status-audit latest` — the whole ledger.
- `/status-audit <agent>` — restrict to one agent name.
- `/status-audit <session>` — restrict to one `session` id.

## Step 3 — Report the seven views

Report **all seven** views, in order. Use "unknown" for any absent field.

1. **Health** — a count of agents per `state` (e.g. `in_progress: 3,
   awaiting_review: 1, blocked: 1, done: 2`). This is the at-a-glance summary.
2. **Per-agent** — one row per agent: its latest `state`, its verdict
   (`review_verdict` / `qa_verdict` if any), and its last-update `ts`.
3. **Blocked** — agents whose latest `state` is `blocked`. **Call these out as
   urgent** — they need a human or a dispatch to unblock.
4. **Stale** — non-terminal agents (latest `state` not `done` / `failed`) with
   **no entry for ≥ 15 minutes** (compare the latest `ts` to now). A stale
   non-terminal agent is a likely stall.
5. **Contradictions** — agents whose latest entry has `state: done` **but**
   `done_criteria_met: no`. A "done" that did not meet its criteria is a
   false-completion signal to surface.
6. **Missing handoffs** — agents whose latest entry has `handoff_target` ≠
   `none` (and not "unknown") **but** the ledger has **no later entry for that
   target agent** in the same session. The promised next agent never started —
   a dropped baton.
7. **Verdict summary** — counts of `review_verdict` (`pass` / `fail` /
   `needs_followup`) and `qa_verdict` (`pass` / `fail` / `blocked`) across the
   scope. The session's quality signal at a glance.

## Step 4 — Read-only guarantee

Do **not** write, move, or delete any file. Do **not** append to the ledger. Do
**not** run `git` mutations. The only output is the report in your reply. After
a run, `git status` is unchanged.

## Supervision pattern — `/loop 5m /status-audit`

This skill is designed to be the periodic health ping for **long headless
work**. Pair it with `/loop`:

```text
/loop 5m /status-audit      # health ping every 5 minutes during long headless work
```

Every 5 minutes the loop re-reads the ledger and re-reports the seven views, so
a supervising human (or a watching session) sees `blocked` agents, stalls
(stale ≥ 15 min), false completions (contradictions), and dropped batons
(missing handoffs) as they emerge — without interrupting the agents at work.
Tune the interval to the cadence of the work (`/loop 1m` for tight loops,
`/loop 15m` for slow long-runs). See `.claude/loop.md` for the loop mechanism.

## Out of scope

- This skill **does not fix** anything — it reports. Unblocking, re-dispatching,
  or correcting a false completion is a follow-up action the lead decides on.
- It does **not** parse agent prose — only the structured ledger fields the
  hook already captured. The determinism lives in the hook (`log-subagent.sh`);
  the report is a read-and-reason task.
