> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Middle Man

**Family:** Couplers

## How to spot it

A type whose methods almost all delegate somewhere else. Frequently the result
of applying [Hide Delegate](../refactorings/hide-delegate.md) until nothing was
left behind it.

## What it costs

A hop with no value. Readers follow it, and every new method on the delegate
needs a matching pass-through, which is [Shotgun Surgery](shotgun-surgery.md) in
miniature.

## Cure

[Remove Middle Man](../refactorings/remove-middle-man.md) and let callers talk
to the real object, or [Inline Method](../refactorings/inline-method.md) for
individual pass-throughs.

## When it is NOT a smell

A deliberate **[Facade](../patterns/facade.md), [Adapter](../patterns/adapter.md),
or anti-corruption layer**. Those delegate on purpose: the value is the
narrowed, translated, or stabilised interface, not the behaviour. A port
implementation that delegates to a vendor SDK is doing its job.
