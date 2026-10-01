> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Chain of Responsibility

**Family:** Behavioral

## Intent

Pass a request along a sequence of handlers until one deals with it.

## The smell it cures

A long if/else ladder deciding who should handle something, duplicated wherever the decision is made.

## Shape

Each handler holds the next. It either handles the request or forwards it.
The chain is assembled at the composition root.

## Why it earns its keep

Handlers are added, removed and reordered without editing each other, and each is testable alone. Request pipelines and middleware stacks are the canonical use.

## When NOT to reach for it

Exactly one handler can ever apply and everyone knows which — that is a lookup, not a chain. Also avoid when an unhandled request falling off the end is silently acceptable: that is a [Silent Catch](../smells/silent-catch.md) in another shape.
