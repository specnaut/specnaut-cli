**Your constitution's size limits now hold from plan through review.** The constitution gains a
`## Size limits` table (defaults: file 300 / 500 lines, function 30 / 50), and it is the only source
of size thresholds — the agents no longer carry their own. The plan measures every file it touches
and is not done while a file over its target grows; tasks extracts before it adds; implement passes
the limits to every subagent and reports `file: before → after`; review rates growth of an
over-target file HIGH. For edits outside the agent chain, `.specnaut/scripts/bash/size-ratchet.sh`
checks staged changes against the branch's merge base — run it by hand or from your pre-commit
runner. An existing constitution does not receive the table from `specnaut upgrade`: run
`/specnaut constitution`, which proposes it.
