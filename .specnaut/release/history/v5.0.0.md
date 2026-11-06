**`/specnaut` now runs on autopilot.** It stops at most once, at the end of `plan`, and only to ask
what only you can answer: business rules, scope, and anything irreversible, destructive, breaking a
public surface, or bringing in a new external service, vendor or cost. After that it implements,
reviews, fixes every CRITICAL or HIGH finding, merges into your base branch, **pushes**, and closes
the backlog item without asking "Ready to merge?" or "Push to origin?". It still halts, and says
why, on a real blocker: an unresolved CRITICAL or HIGH finding, a failed review, a merge that cannot
fast-forward, a push the remote refuses. A rejected push is never forced.

**Technical decisions are taken by the expert agents, not put to you.** Architecture, design
patterns, layering, security hardening and performance trade-offs are settled at plan time by
`architect-expert`, `security-expert` and, on a hot path, `performance-expert`, against Specnaut's
intent: long-lived software, clean, SOLID, secure by default. The plan records what was decided and
what was rejected; the stop reports it instead of asking you to confirm a recommendation.

**Want a human on every merge?** `specnaut upgrade` adds `.specnaut/workflow.yml`. Set
`merge: manual` and the chain asks once, at the review verdict, before merging and pushing. For a
single run, pass `--manual-merge`. It is a major release because that one-line edit is the only way
back to the previous behaviour — see UPGRADING.md.
