---
name: status-audit
description: Audit structured workflow status from the agent ledger. Use when checking progress, blocked agents, stale runs, or when scheduling /loop supervision for long-running work.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: [latest|agent-name|spec-slug]
---

# Status Audit

This skill audits the structured workflow ledger written by the project hooks.

## Usage

Run the bundled script from the repository root:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/audit_workflow.mjs "$ARGUMENTS"
```

If no argument is provided, audit the latest known status for all agents.

## Expected Output

Produce a concise audit with:

1. Overall workflow health
2. Current state per agent
3. Review and QA verdicts when available
4. Any blocked or stale agents
5. Missing handoffs or missing validation
5. The single most useful next action

## Audit Rules

- Treat agents with `STATE: blocked` or `STATE: failed` as urgent.
- Treat `REVIEW_VERDICT: fail` or `QA_VERDICT: fail` as urgent follow-up.
- Treat `QA_VERDICT: blocked` as a blocker even if the workflow state is not terminal yet.
- Treat agents with `STATE: in_progress`, `awaiting_review`, or `awaiting_qa`
  and no update for 15+ minutes as stale.
- Flag terminal outputs that say `done` while `DONE_CRITERIA_MET: no`.
- Flag missing `HANDOFF_TARGET` when the state implies a downstream phase.

## Good Loop Prompts

```text
/loop 5m /status-audit latest
/loop 5m /status-audit 176-refactor-cache-signed-urls
```

## Notes

- This skill works best when workflow agents preload `workflow-contract` and
  `handoff-protocol`.
- Review and QA insights are richer when agents also preload
  `review-findings-contract` and `qa-report-contract`.
- The ledger is session-friendly, but it remains useful even without active
  background tasks.