> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Abstract Factory

**Family:** Creational

## Intent

Create whole families of related objects without naming their concrete types.

## The smell it cures

Call sites that must pick a matching set of implementations and can pick an inconsistent one.

## Shape

One factory interface with a method per member of the family. Each concrete
factory returns a mutually consistent set. Callers receive the factory and ask
it for parts.

## Why it earns its keep

Makes an inconsistent combination unrepresentable: you cannot take one member from family A and one from family B, because you only ever hold one factory.

## When NOT to reach for it

There is only one family, or the members are not actually related — then it is [Factory Method](factory-method.md) repeated, with extra ceremony and no invariant.
