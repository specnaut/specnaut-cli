> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Bridge

**Family:** Structural

## Intent

Split an abstraction from its implementation so the two can vary independently.

## The smell it cures

A class hierarchy multiplying along two axes at once — the combinatorial explosion behind [Parallel Inheritance Hierarchies](../smells/parallel-inheritance-hierarchies.md).

## Shape

The abstraction holds a reference to an implementor interface and delegates
the varying part to it. Both sides subtype independently.

## Why it earns its keep

Turns a multiplicative hierarchy into an additive one: N abstractions and M implementations become N+M types instead of N×M.

## When NOT to reach for it

Only one axis actually varies. Then the second dimension is imagined, and you have paid an indirection for it.
