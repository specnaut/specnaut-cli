# Quickstart: Gate-aware approval STOPs + headless VM mode

## The approval gates (raised by the chain, remote mode on)

```bash
# Plan checkpoint
specflow gate raise --type plan_approval --title "Approve the plan for 005-cli-gate-client" \
  --payload '{"summary":"3 modules + remote switch","planRef":".specflow/specs/005-…/plan.md"}'
# → {"approved":true}            exit 0 → chain resumes into /specflow tasks
# → {"approved":false,"note":"…"} exit 0 → chain halts, reports the revision note
# → exit 3/4/5                    → chain halts cleanly (never auto-approves)

# Pre-merge STOP #2
specflow gate raise --type merge_approval --title "Approve merge of 005-cli-gate-client" \
  --payload '{"summary":"gate client + tests, 24 green","prUrl":"<branch/diff>"}'
# → {"approved":true} → /specflow merge ; {"approved":false} → halt on branch
```

## Headless VM mode (see `docs/headless-vm-mode.md`)

```bash
export SPECFLOW_REMOTE=1            # + a logged-in project (specflow cloud login) or SPECFLOW_CLOUD_TOKEN
claude -p "/specflow specify \"<feature>\""   # unattended; every STOP becomes a gate
# resolve clarify / plan / merge gates from your phone → the run resumes automatically
```

## Tests / checks

```bash
deno task check && deno lint && deno fmt --check && deno task test
```

`tests/integration/headless_docs_test.ts` asserts the headless doc exists and documents remote-mode
enablement + the gate-resolution flow, and that the bundled chain templates carry the guarded
`plan_approval` / `merge_approval` branches. The Windsurf-cap and plugin-mirror suites guard the
template edits.
