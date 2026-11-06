**A release about names, and about who a piece of writing is addressed to.**

`/backlog` is now **`/board`**. The skill drove all five status columns while being named after one
of them, so `/backlog close` on a card in _In review_ read as a category error — and the bundled
`backlog.md` documented the collision against itself, describing "the 5 status columns" and then
naming the first one **Backlog**. `board` is not new vocabulary: it is the word the skill's own
prose already used 25 times. Only the command was still on the old one.

`specnaut upgrade` performs the whole migration — the old skill is removed, the new one added, and
the emptied directory pruned. Verified on a real upgrade from the previous layout: no leftover
folder, no manual step. What did **not** move is the vocabulary for where items are stored, because
"backlog" is the right word for that: `backlog_backend`, `--backlog`, `--backlog-url`,
`.specnaut/backlog.md`, `.specnaut/backlog/NNN-*.md` and `.specnaut/scripts/backlog/` are all
untouched. No lock migration, no flag change. There is deliberately no `/backlog` alias — the
previous release deleted two command shims because a second surface fronting a skill has to be kept
in agreement with it and drifts the moment it is not, and an alias would rebuild exactly that.

`/board` and `/specnaut` now have a boundary rather than an overlap: `/board` owns backlog
management, `/specnaut` owns specification, planning, implementation and review. `groom` has one
door, and it is `/board groom`.

The rest of the release is one class of defect, found by asking who each shipped file is talking to.
Several were written and verified inside the Specnaut repository, where their paths resolve, and
then shipped to projects where they do not — a contract pointing at
`skills/backlog/scripts/
<backend>/_config.sh` instead of the flat
`.specnaut/scripts/backlog/_config.sh` that is actually installed; a completion checklist
prescribing `deno fmt && deno lint && deno task bundle` as _the_ gate command to any project,
including the ones with no Deno in them; skills citing their siblings by source path rather than by
the name a harness resolves. That class fails quietly: an agent that cannot find `_config.sh` does
not error, it assembles the URL by hand, which is the one thing the contract exists to prevent.
Eight files, and a guard that now scans every shipped entry — core and harness-specific — for paths
that only exist in a checkout.

One of the eight was the file whose entire job is telling a Cursor user what to type: it advertised
`/specnaut-backlog`, a command no harness emits any more. It survived a full rename sweep because
the sweep matched `/backlog` and this string is the same skill wearing a harness prefix. Prose
naming a generated identifier is now checked against the generator.

Two supporting fixes are worth naming. `upgrade` removed files and reported them removed but never
pruned the emptied directory, so a renamed skill left its old name sitting in the harness's skills
list beside the new one — and the fix for that did nothing at all on Windows, because its
containment check hardcoded the POSIX separator. The first defect was invisible until a rename
existed to expose it; the second was invisible on two platforms out of three.

Finally, this repository now holds **no Actions secrets**. The packaging channels used to be pushed
to, which meant a public repository held write credentials for everything that packages or lists it.
They now pull from the public Releases API instead, and a test fails the suite on any workflow that
reintroduces a stored secret.
