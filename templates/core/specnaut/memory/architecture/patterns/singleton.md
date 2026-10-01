> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Singleton

**Family:** Creational

## Intent

Guarantee one instance and give the program a global way to reach it.

## The smell it cures

Nominally, repeated construction of something that must be unique.

## Shape

A type that hides its constructor and hands out one shared instance.

## Why it earns its keep

Rarely. The uniqueness is usually a real requirement; the *global access* is the part that is not, and the two are separable.

## When NOT to reach for it

Almost always. It is [Implicit Global](../smells/implicit-global.md) with a design-pattern name: it hides a dependency from the signature, makes tests order-dependent, and prevents substitution. If uniqueness matters, construct one instance at the composition root and **inject** it — you get the invariant without the global. Prescribing this pattern needs a stronger justification than any other in this catalogue.
