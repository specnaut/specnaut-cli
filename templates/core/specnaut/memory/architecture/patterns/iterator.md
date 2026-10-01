> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Iterator

**Family:** Behavioral

## Intent

Traverse a collection without exposing how it is stored.

## The smell it cures

Callers that know the internal representation of a collection — an [Inappropriate Intimacy](../smells/inappropriate-intimacy.md) with a data structure.

## Shape

The collection returns a cursor exposing only 'is there more' and 'give me
the next'. Most languages have this built in.

## Why it earns its keep

The storage can change — array to tree to stream — without touching a caller.

## When NOT to reach for it

Your language already provides iteration and you are hand-rolling it. Implementing this from scratch where an idiom exists is a readability regression, not a pattern.
