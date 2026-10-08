> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Inappropriate Intimacy

**Family:** Couplers

## How to spot it

Two modules that reach into each other's internals — private fields, internal
helpers, or knowledge of the other's storage shape. Often mutual.

## What it costs

Neither can be changed or tested alone, so they are one module wearing two
names. Bidirectional coupling also blocks extraction: you cannot move either
one out.

## Cure

[Move Method](../refactorings/move-method.md) and
[Move Field](../refactorings/move-field.md) to put things where they are used,
[Hide Delegate](../refactorings/hide-delegate.md) to stop the reaching, and
[Change Bidirectional Association to Unidirectional](../refactorings/change-association-to-unidirectional.md)
where only one direction is needed.

## When it is NOT a smell

Two types inside the **same bounded context or module** that are meant to know
each other — an aggregate and its entities, a class and its nested helper. The
smell is intimacy *across a boundary*, so identify the boundary before naming
it.
