**`/board groom` now finishes the job: a groomed item leaves the intake column.** Grooming used to
size, prioritise and clarify an item and then leave it in `Backlog`, so the next run groomed it
again. The product-owner's own contract now ends grooming with a promotion to the board's ready
column, so groomed items are skipped by column alone. The columns are read from your board
(`Backlog` → `Ready` by default). If your board names them differently, the first groom asks once
and records the answer in `.specnaut/backlog-config.yml`. A move that fails is listed in the groom
report. Also in this release: scaffolds for Codex, Cursor, Windsurf, Copilot, OpenCode and
Antigravity no longer point their agents at `.claude/` files those harnesses never receive.
