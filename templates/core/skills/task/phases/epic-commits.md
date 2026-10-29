# Epic commits — one commit per child, placeable from `git log` alone

Loaded by `phases/implement.md` when the item being worked is an **epic** with
open sub-issues. `merge` and the fixup-fold procedure consume this format; none
of them restates it. This file is the single definition.

On an epic branch every child produces exactly one commit, and those commits are
the **only** machine-readable record of which children are already done — child
issues stay open until the epic merges, so issue state says nothing about
progress. The resume path reads these commits and nothing else. That makes this
convention load-bearing rather than cosmetic: an unparseable subject line is a
loop that cannot resume.

## The format

```text
<type>(T<NN>): <subject> (#<child-issue>)

<body>

Epic: #<epic-issue>
```

A worked example — the third child of epic `#540`, whose own issue is `#547`:

```text
feat(T03): resolve the backlog id from the installed backend (#547)

…body…

Epic: #540
```

- **`T<NN>` is the child's ordinal in the epic's dependency order**, minted over
  the **sub-issues**: `T01`, `T02`, `T03`, … It is dense and stable, so the
  match from a commit to its child is one-to-one and the resume path is a
  deterministic parse rather than a guess. **The parse is width-agnostic —
  `T(\d+)`**: write two digits; another width is still legal and still parses.
- **`(#<child-issue>)` is the child's own GitHub issue number.** Never the
  epic's. The epic never appears in the subject line.
- **`Epic: #<epic-issue>` is a trailer.** Machine-readable, greppable
  (`git log --grep '^Epic: #540'`), and out of the subject so the subject stays
  about the child.

## An id is never inherited

The rule that a commit carries the backlog id of the thing it is **about** — and
that a fix to a pre-existing defect keeps its own id rather than the feature's —
is stated once, in `phases/merge-squash.md`. It holds here unchanged. This file
adds where the epic ordinal goes; it does not restate what an id means.

A **fixup** is not an exception to it. A fixup is attributed to the child at
fault and folds into **that child's** commit; it never acquires an id of its own
and never inherits a sibling's. What the fold does mechanically belongs to the
epic merge path, not here.

## Reading it back

`bash .specnaut/scripts/bash/epic-status.sh` is the one reader of this format: it prints a
`CHILD T<NN> #<child> <sha>` line per child, checks the ordinals run 1, 2, 3… and that no child
has two commits, and exits 12 when the history does not read back to the board. Never parse the
log a second way. If it exits 12, the branch has been rewritten by something that did not follow
this file: stop and say so rather than picking one reading.
