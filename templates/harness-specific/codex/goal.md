# Project goal prompt

This file customizes what `/goal` runs when invoked without an explicit
objective. Specnaut ships a sensible default below — edit freely to match
this project's hygiene needs.

## Default goal prompt

Run a hygiene pass on this Specnaut project:

1. Invoke the `/specnaut groom` skill — it grooms the backlog, surfaces
   stale PRs, and flags orphan specs.
2. If anything actionable came out of the pass, summarize it concisely
   so the human reading the result can decide what to do.
3. If everything is healthy, say so in one sentence and stop. Do not
   manufacture work.

## Recommended invocation

`/goal` is one-shot long-horizon, not a recurring timer. Good moments to
run it:

- **Start of a session**: open Codex, run `/goal`, let it groom while
  you context-switch.
- **End of a sprint**: run `/goal` to leave the backlog tidy before a
  release branch is cut.
- **Lifecycle controls**: `/goal pause`, `/goal resume`, `/goal clear`.

## Customizing further

Append project-specific checks to the prompt above. Examples:

- "Check that the staging deploy from the last `main` commit succeeded."
- "Verify the daily backup ran in the last 24 hours."
- "Ping if any feature flag is still enabled after its sunset date."

Each `/goal` run loads the full prompt, so keep it focused.
