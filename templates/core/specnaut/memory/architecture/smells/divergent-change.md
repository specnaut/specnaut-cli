> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Divergent Change

**Family:** Change preventers

## How to spot it

One file that changes for many unrelated reasons. The evidence is in history:
run the log for the file and read the commit subjects. If they belong to
different features, the file has more than one reason to change.

## What it costs

Unrelated work collides in the same file, so changes serialise and merge
conflicts are routine. Reviewers cannot judge a diff without understanding
responsibilities that have nothing to do with it.

## Cure

[Extract Class](../refactorings/extract-class.md) per reason to change, then
[Move Method](../refactorings/move-method.md) to put behaviour with the data it
serves. This is the Single Responsibility Principle stated as a symptom — see
[DDD and clean code](../ddd-and-clean-code.md).

## When it is NOT a smell

A composition root, a configuration module, or a route table. Those files exist
precisely to change whenever anything they wire up changes; the churn is their
job. Judge them by whether they contain *decisions* — wiring is not a
responsibility.
