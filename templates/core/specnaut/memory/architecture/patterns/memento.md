> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Memento

**Family:** Behavioral

## Intent

Capture an object's internal state so it can be restored later, without exposing that state.

## The smell it cures

Undo or snapshot logic that requires callers to read and write internals, breaking encapsulation.

## Shape

The object produces an opaque token of its own state and accepts one back.
Only the originator can interpret the token.

## Why it earns its keep

Restoration becomes possible without publishing the internal shape, so the shape can still change freely.

## When NOT to reach for it

The state is already a public immutable value — then a copy is the memento and the pattern is ceremony. Also watch the cost: naive snapshots of large state are a memory problem you introduced.
