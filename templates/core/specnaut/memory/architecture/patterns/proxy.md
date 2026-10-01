> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Proxy

**Family:** Structural

## Intent

Stand in for another object to control access to it.

## The smell it cures

Access control, laziness, or remoting logic scattered through callers.

## Shape

Same interface as the subject; the proxy decides whether, when, and how to
forward.

## Why it earns its keep

Callers stay unaware of laziness, remoteness, or a permission check, so those concerns change without touching them.

## When NOT to reach for it

It only forwards — that is a [Middle Man](../smells/middle-man.md). It is also easily confused with [Decorator](decorator.md): a decorator *adds* behaviour, a proxy *controls access*. Prescribing the wrong one of the two suggests the diagnosis was not made.
