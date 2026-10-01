> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Composite

**Family:** Structural

## Intent

Let clients treat individual objects and compositions of them uniformly.

## The smell it cures

Callers branching on 'is this one thing or many' — a [Switch Statement](../smells/switch-statements.md) on structure.

## Shape

A common interface implemented by both leaves and containers; the container
implements operations by delegating to its children.

## Why it earns its keep

Recursion lives in the structure rather than in every caller, so adding a new operation does not touch the traversal.

## When NOT to reach for it

The hierarchy is shallow and fixed, or leaves and containers genuinely support different operations — forcing a shared interface then produces [Refused Bequest](../smells/refused-bequest.md).
