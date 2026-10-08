> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Data Class

**Family:** Dispensables

## How to spot it

A type that is only fields and accessors, with every rule about those fields
implemented by its callers. Look for callers that fetch several fields and
compute something from them — that computation belongs inside.

## What it costs

The invariants of the data have no home, so each caller enforces its own
version. This is how the same concept ends up with three different definitions
of 'valid'.

## Cure

[Move Method](../refactorings/move-method.md) to bring the behaviour to the
data, [Encapsulate Field](../refactorings/encapsulate-field.md) and
[Encapsulate Collection](../refactorings/encapsulate-collection.md) to stop the
leak. Systemically this is [Anemic Domain Model](anemic-domain-model.md).

## When it is NOT a smell

A **DTO, event payload, or transport record** at a boundary. Those are
deliberately behaviour-free: they exist to cross a wire or a layer, and adding
logic to them couples the boundary to the domain. Also fine for a pure value
object whose only rule is enforced at construction.
