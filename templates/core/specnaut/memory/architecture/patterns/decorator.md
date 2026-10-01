> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Decorator

**Family:** Structural

## Intent

Add behaviour to an object at run time by wrapping it in something with the same interface.

## The smell it cures

Subtype explosion for optional, combinable behaviours; flags on a constructor that switch cross-cutting concerns on and off.

## Shape

The decorator implements the same interface, holds the wrapped instance, and
adds behaviour before or after delegating.

## Why it earns its keep

Behaviours compose in any order without a type per combination, and each one is testable alone. Retries, caching, logging and metrics around a port are the canonical use.

## When NOT to reach for it

The behaviour is not optional, or the ordering of wrappers is significant and unstated — a stack whose correctness depends on assembly order is worse than one class. Also avoid when callers need to reach the concrete type through the wrapper.
