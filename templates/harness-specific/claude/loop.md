# Project loop prompt

This file customizes what `/loop` does when invoked without an explicit
prompt. Specflow ships a sensible default below — edit freely to match
this project's hygiene needs.

## Default prompt

Run a hygiene pass on this Specflow project:

1. Invoke the `/specflow groom` skill — it grooms the backlog, surfaces
   stale PRs, and flags orphan specs.
2. If anything actionable came out of the pass, summarize it concisely
   so the human reading the loop output can decide what to do.
3. If everything is healthy, say so in one sentence and stop. Do not
   manufacture work.

## Recommended schedules

- **Active development**: `/loop 1h` — frequent grooming during a sprint.
- **Quiet projects**: `/loop 12h` or `/loop 24h` — daily cadence.
- **One-off check**: just `/specflow groom` (no loop) — runs once and exits.

## Customizing further

Add project-specific checks below the default by appending bullets to the
prompt above. Examples:

- "Check that the staging deploy from the last `main` commit succeeded."
- "Verify the daily backup ran in the last 24 hours."
- "Ping if any feature flag is still enabled after its sunset date."

Each loop iteration runs the entire prompt, so keep it focused — long
prompts cost more tokens and drift out of relevance.
