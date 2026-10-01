> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Prototype

**Family:** Creational

## Intent

Create a new object by copying an existing configured one rather than constructing it from scratch.

## The smell it cures

Construction logic duplicated to reproduce an object whose setup is expensive or whose full configuration the caller cannot see.

## Shape

The type exposes `copy()` returning an independent instance. Callers keep a
configured exemplar and clone it.

## Why it earns its keep

A caller can reproduce an object without knowing how it was configured, which keeps configuration knowledge in one place.

## When NOT to reach for it

The object is cheap to construct, or copying it is ambiguous because it owns references — a shallow copy that shares mutable state is a defect wearing a pattern's name.
