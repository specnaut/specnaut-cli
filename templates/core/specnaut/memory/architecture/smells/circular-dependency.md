> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Circular Dependency

**Family:** Structural

## How to spot it

Module A depends on B which depends (directly or transitively) on A. Use the
language's own module graph tooling where one exists; fall back to import
analysis. Report the **full cycle path**, not just the two ends.

## What it costs

Neither module can be understood, tested, extracted, or initialised
independently. In languages with load-order semantics it also produces
partially-initialised values that fail far from the cause.

## Cure

Invert one edge: [Extract Interface](../refactorings/extract-interface.md) and
depend on the abstraction, or [Move Method](../refactorings/move-method.md) to
put the shared logic in a third module both can depend on. This is the
Dependency Inversion Principle applied to a concrete cycle.

## When it is NOT a smell

A cycle **within one cohesive module** that the language resolves and that never
crosses a published boundary — mutually recursive functions, a type referring to
itself. The defect is a cycle *between* units that are supposed to be
separable.
