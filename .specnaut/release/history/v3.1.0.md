**Two files that belong to your project are no longer at risk, and the board keeps itself honest.**

`AGENTS.md` and `.specnaut/memory/constitution.md` are yours — Specnaut writes them once, at init, and
never again. That guarantee had a hole: it only held while the file had no entry in
`installed.lock`. Any older binary that once tracked one, or a partial upgrade that got a single file
in, left an entry behind — and from then on a plain `specnaut upgrade` replaced the file wholesale.
No `--force`, no "preserved" line in the report, no warning. The protection worked for fresh
installs and failed for exactly the long-lived ones whose `AGENTS.md` had accumulated something worth
keeping. It now holds regardless of the lock, and an affected project heals itself on its next
upgrade. As a consequence `--force` no longer reaches either file; deleting one and re-running
remains the way to reset it to the bundled version.

`specnaut upgrade --dry-run` also stopped writing. It renamed a legacy `.specflow/` directory before
the dry-run guard was reached, and populated the reconciliation staging area — then printed
"no files written".

On the backlog side, closing an issue through a merge keyword closes the issue and moves nothing:
the card sits in whatever column it was in. `/specnaut groom` now reports that drift, `/specnaut
merge` corrects it after landing, and the correction is batched — any number of cards costs two
requests, not two per card.
