> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Template Method

**Family:** Behavioral

## Intent

Fix the skeleton of an algorithm in a base type and let subtypes fill in named steps.

## The smell it cures

[Duplicate Code](../smells/duplicate-code.md) across siblings whose overall shape matches but whose details differ.

## Shape

A non-overridable method calls a sequence of steps; subtypes override the
steps, never the sequence.

## Why it earns its keep

The invariant order lives in one place and cannot be broken by a subtype, which is exactly the part that is expensive to get wrong.

## When NOT to reach for it

Subtypes need to change the *order*, not the steps — then inheritance is the wrong axis and [Strategy](strategy.md) composes better. Deep hierarchies of template methods produce [Refused Bequest](../smells/refused-bequest.md).
