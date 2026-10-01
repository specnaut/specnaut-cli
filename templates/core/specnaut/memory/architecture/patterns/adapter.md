> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Adapter

**Family:** Structural

## Intent

Let a type with the wrong shape satisfy an interface the caller already depends on.

## The smell it cures

[Alternative Classes with Different Interfaces](../smells/alternative-classes.md), and vendor types leaking into code that should not know them.

## Shape

The caller depends on a port it owns. The adapter implements that port and
translates to the foreign API, absorbing its vocabulary and its errors.

## Why it earns its keep

It is the mechanism that keeps a [Layer Violation](../smells/layer-violation.md) from being necessary: the inner code names only its own port, and the vendor stays outside. Swapping the vendor becomes one new adapter.

## When NOT to reach for it

You own both sides and can simply change one of them — then converge the interfaces instead and delete the hop. An adapter over code you control is often a [Middle Man](../smells/middle-man.md).
