> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Large Class

**Family:** Bloaters

## How to spot it

A type carrying more fields, methods, or responsibilities than one reader can
hold. Look for subsets of fields that are only ever touched together by
subsets of methods — that partition is the class trying to split itself.

## What it costs

Every reason to change the system arrives at the same file, so unrelated work
serialises and conflicts. Tests need most of the object constructed to
exercise any of it.

## Cure

[Extract Class](../refactorings/extract-class.md) along the field/method
partition. If the extracted piece is only ever used through the original,
[Hide Delegate](../refactorings/hide-delegate.md). Where the split is by
behaviour rather than data, consider
[Strategy](../patterns/strategy.md).

## When it is NOT a smell

A type that is large because its **domain concept** is large and cohesive — a
value object with many derived accessors, a state machine with one method per
transition. If every method genuinely needs the same fields, splitting it just
creates two classes that must change together.
