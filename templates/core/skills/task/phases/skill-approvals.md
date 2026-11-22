# Shipped-skill approvals

`phases/script-gate.md` § The instructions verdict loads this doc when the last run named a skill
Specnaut ships or the lock's record of one: what to show for each line, and what the question adds.
`phases/merge.md` step 0 acts on that verdict.

A `differs from the copy Specnaut ships` reason names a skill Specnaut ships whose bytes are not the
shipped copy, even where the base holds the same edit: show `specnaut diff <path>`, which compares
it with that copy. A yes to such a line is remembered while the skill keeps those bytes: the
landing records it (path, SHA-256) in `.specnaut/approved-skills.txt`, in its own commit on the
judged one. Only the landing writes that file: a branch's own change to it, but a deletion, is named
and no yes holds it (`APPROVAL instructions moved`), so stop on the branch. A forge merge or a
direct push lands it unjudged: the file is trusted as the base commits it.

A `records a skill digest that is not the copy Specnaut ships` reason names
`.specnaut/installed.lock`: the branch re-stamped a skill's digest, which would vouch for that copy
from then on; show its diff.

The question is the instructions verdict's own. When a `differs from the copy Specnaut ships` line
is among them, add: *"Yes is remembered for those skills while they keep these bytes; deleting
`.specnaut/approved-skills.txt` revokes it."*
