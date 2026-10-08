> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Long Method

**Family:** Bloaters

## How to spot it

A function whose body you have to scroll, or which needs a comment every few
lines to stay readable. The reliable tell is not line count but **the comment
that names a section** — it is telling you where the seam is.

## What it costs

Nothing inside can be reused, tested, or named. Every reader pays the cost of
understanding the whole to change a part of it, and every change risks the
parts they did not read.

## Cure

[Extract Method](../refactorings/extract-method.md) at each seam a comment
names. If the extracted piece needs many locals, that is
[Long Parameter List](long-parameter-list.md) arriving — see
[Introduce Parameter Object](../refactorings/introduce-parameter-object.md).
[Replace Temp with Query](../refactorings/replace-temp-with-query.md) and
[Decompose Conditional](../refactorings/decompose-conditional.md) usually do
most of the work.

## When it is NOT a smell

A long, flat sequence of genuinely unrelated setup steps with no branching and
no reuse — a fixture builder, a wiring root, a generated mapper. Splitting it
produces a dozen single-caller functions and a reader who now has to jump
between them. Length alone is not the defect; **hidden structure** is.
