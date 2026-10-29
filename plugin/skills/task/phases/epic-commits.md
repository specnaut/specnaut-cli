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
  deterministic parse rather than a guess.
  **The parse is width-agnostic — `T(\d+)`.** Two digits is what this document
  renders and what you should write; it is a convention, not a constraint, and a
  commit written with a different width is still legal and still parses. See
  "Two `T` counters" below for why the width is worth keeping anyway.
- **`(#<child-issue>)` is the child's own GitHub issue number.** Never the
  epic's. The epic never appears in the subject line.
- **`Epic: #<epic-issue>` is a trailer.** Machine-readable, greppable
  (`git log --grep '^Epic: #540'`), and out of the subject so the subject stays
  about the child.

### Two `T` counters exist, and they are not the same counter

An epic has **one** `tasks.md`, whose ids run in execution order across every
child: `T001`, `T002`, … Those ids **never** appear in a commit's scope
position. The scope position carries the epic ordinal only.

A reader will assume the two are the same counter unless told. One child may
contain several `tasks.md` entries and still produces exactly one commit.

**What separates them is position, not width.** A `tasks.md` id lives in
`tasks.md`; an epic ordinal lives in a commit's scope position. Nothing else in
the format depends on how many digits either one carries, and the parse does
not: it is `T(\d+)`.

The rendering convention — `tasks.md` writes three digits, the scope position
writes two — is kept because it makes the two visually distinct on sight, which
is worth having even though nothing enforces it. It is **not** what makes the
match correct.

**Why the width is a convention and not a rule.** D6 recorded the format with
the sample `type(T012): sujet (#547)`; D18, answered later and specifically
about what the number *is*, gives the series as `T01`, `T02`, …. The two do not
agree on width. Rather than edit either recorded string, the format takes
neither as binding: both are legal, and `T(\d+)` accepts both. The cost is
named rather than hidden — "dense and stable" is a property of how the ordinals
are **minted**, not something the format can enforce on a hand-written commit.

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

Given a commit on an epic branch, the child it belongs to is recoverable two
ways, and they must agree:

- the `(#<child-issue>)` in the subject — the child's issue number outright;
- the `T<NN>` ordinal — its position in the epic's dependency order.

If they disagree, the branch has been rewritten by something that did not read
this file. Stop and say so rather than picking one.
