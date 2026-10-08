> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Message Chains

**Family:** Couplers

## How to spot it

A caller navigating a graph to reach what it wants. The tell is a chain of
accessors where each step is only there to get to the next.

## What it costs

The caller is coupled to the shape of the whole path, so any structural change
anywhere along it breaks a module that only wanted the value at the end.

## Cure

[Hide Delegate](../refactorings/hide-delegate.md) so the first object answers
the question directly. If the caller only needs the final value,
[Extract Method](../refactorings/extract-method.md) on the far object and
[Move Method](../refactorings/move-method.md) it back.

## When it is NOT a smell

A **fluent builder or query DSL**, where chaining is the designed interface and
each call returns a configured self. Also fine for a short, stable path inside
one module. Over-applying the cure produces [Middle Man](middle-man.md).
