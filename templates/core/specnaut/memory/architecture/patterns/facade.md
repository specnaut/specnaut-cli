> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Facade

**Family:** Structural

## Intent

Offer one narrow entry point to a broad or awkward subsystem.

## The smell it cures

[Message Chains](../smells/message-chains.md) and callers that must know the order of operations across several collaborators.

## Shape

One type exposing the few operations callers actually need, implemented by
orchestrating the subsystem behind it.

## Why it earns its keep

Callers depend on a small stable surface instead of a large moving one, so the subsystem can be reorganised without a sweep.

## When NOT to reach for it

It grows to expose everything behind it, at which point it is a [Middle Man](../smells/middle-man.md) that added a name and no constraint. The value is in what it *refuses* to expose.
