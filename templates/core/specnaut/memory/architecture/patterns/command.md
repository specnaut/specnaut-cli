> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Command

**Family:** Behavioral

## Intent

Turn a request into an object, so it can be passed, queued, logged, or undone.

## The smell it cures

Callers coupled to the receiver and to the timing of an action; undo logic scattered across a UI or a service.

## Shape

An interface with a single `execute()`, and optionally `undo()`. Concrete
commands hold their arguments and their receiver.

## Why it earns its keep

Invocation is separated from execution, which is what makes queueing, retrying, auditing and undo possible at all.

## When NOT to reach for it

The action is called immediately, once, from one place. Wrapping a direct call in an object then adds a type per action and buys nothing.
