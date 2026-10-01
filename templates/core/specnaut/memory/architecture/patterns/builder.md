> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Builder

**Family:** Creational

## Intent

Construct a complex value step by step, separating how it is assembled from what it becomes.

## The smell it cures

[Long Parameter List](../smells/long-parameter-list.md) in constructors, and telescoping overloads that differ only in which optional arguments they take.

## Shape

A builder accumulates configuration through named steps and produces the
finished value on a final call. The product is immutable once built.

## Why it earns its keep

Call sites become self-documenting, and optional configuration stops being positional. The product can enforce its invariants once, at build time.

## When NOT to reach for it

The type has a handful of required fields and nothing optional. A builder there adds a mutable intermediate and a way to forget a step — the constructor already had neither.
