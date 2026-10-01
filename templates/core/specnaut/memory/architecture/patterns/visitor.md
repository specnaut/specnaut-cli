> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Visitor

**Family:** Behavioral

## Intent

Add operations to a stable object structure without modifying its types.

## The smell it cures

A new operation requiring an edit to every type in a hierarchy — [Shotgun Surgery](../smells/shotgun-surgery.md) over a type tree.

## Shape

Each element accepts a visitor and calls the method for its own type. Each
new operation is a new visitor.

## Why it earns its keep

Adding an *operation* becomes additive. It also gets exhaustiveness checking in languages that provide it, so a missed case is a compile error rather than a gap.

## When NOT to reach for it

The set of *types* changes more often than the set of operations — visitor makes that direction expensive, since every visitor must gain a method. It is the wrong trade unless the structure is genuinely stable, and it is heavy machinery to read.
