> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# State

**Family:** Behavioral

## Intent

Let an object change its behaviour when its internal state changes, as if it changed type.

## The smell it cures

[Switch Statements](../smells/switch-statements.md) on a status field, repeated in every method, plus [Temporary Field](../smells/temporary-field.md) for values only valid in some states.

## Shape

One type per state, each implementing the same operations and returning the
next state. The context delegates to its current state.

## Why it earns its keep

Illegal transitions become unrepresentable rather than merely unhandled, and adding a state is a new type instead of an edit to every method.

## When NOT to reach for it

There are two states and one branch. A boolean is clearer than two classes. Closely related to [Strategy](strategy.md) — the difference is that states know about each other and choose successors.
