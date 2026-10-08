> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Data Clumps

**Family:** Bloaters

## How to spot it

The same group of values appearing together in several places — parameter
lists, field groups, map keys. Test it: **remove one of them and ask whether
the rest still mean anything.** If not, they are one concept.

## What it costs

The concept exists in the system but has no name and no home, so the rules
that govern it are re-implemented at every site and drift apart.

## Cure

[Extract Class](../refactorings/extract-class.md) or
[Introduce Parameter Object](../refactorings/introduce-parameter-object.md).
Once the concept has a home, the validation scattered across call sites
usually collapses into it — that collapse is how you know the extraction was
right.

## When it is NOT a smell

Values that co-occur by coincidence rather than by meaning — two unrelated
ids that happen to be passed together in one layer. Bundling them couples
things that have no reason to change together. Apply the removal test before
naming this.
