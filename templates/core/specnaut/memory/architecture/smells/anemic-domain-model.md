> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Anemic Domain Model

**Family:** Structural

## How to spot it

Domain types that are pure data, with every rule implemented in services or use
cases. The system-wide version of [Data Class](data-class.md): look for a
service layer that grows whenever a domain rule changes.

## What it costs

The domain layer holds no invariants, so nothing is guaranteed by
construction — every caller must remember to run the checks in the right order.
Rules get duplicated across services and drift.

## Cure

[Move Method](../refactorings/move-method.md) to push rules onto the types they
constrain; [Replace Data Value with Object](../refactorings/replace-data-value-with-object.md)
so values can enforce themselves. See
[DDD and clean code](../ddd-and-clean-code.md) for the building blocks.

## When it is NOT a smell

A layer that is *supposed* to be data-only — transport records, persistence
rows, event payloads, generated clients. Also fine in a system with genuinely no
domain rules: a pipeline that moves and reshapes data has nothing to enforce, and
inventing invariants for it is [Speculative Generality](speculative-generality.md).
