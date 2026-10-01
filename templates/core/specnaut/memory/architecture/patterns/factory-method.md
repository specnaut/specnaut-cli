> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Factory Method

**Family:** Creational

## Intent

Let a type defer which concrete thing it creates to a method subtypes override.

## The smell it cures

[Switch Statements](../smells/switch-statements.md) inside a constructor, and construction logic duplicated at call sites.

## Shape

A creator declares `make() -> Product` and uses it in its own methods.
Each subtype returns a different concrete product. Callers hold the creator
and never name a product type.

## Why it earns its keep

Adding a product is a new subtype rather than an edit to existing code — Open/Closed applied to construction.

## When NOT to reach for it

There is one product and no second in sight; a plain constructor says more. Reaching for it to 'allow future extension' is [Speculative Generality](../smells/speculative-generality.md).
