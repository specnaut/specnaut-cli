> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Speculative Generality

**Family:** Dispensables

## How to spot it

Abstraction with one implementation and no second in sight: an interface with a
single implementer, a hook nobody registers, an unused type parameter, a
parameter every caller passes the same value for.

## What it costs

Every reader pays the indirection tax for flexibility nobody uses. Worse, the
guessed extension point is usually in the wrong place, so the real second case
does not fit it and the abstraction has to be redone anyway.

## Cure

[Collapse Hierarchy](../refactorings/collapse-hierarchy.md),
[Inline Class](../refactorings/inline-class.md),
[Remove Parameter](../refactorings/remove-parameter.md). Prefer the concrete
thing now and the abstraction when the second case actually arrives — it will
tell you where the seam belongs.

## When it is NOT a smell

A **port with one adapter** in a hexagonal design, where the interface exists to
invert a dependency and keep the domain testable. The second implementation is
the test double, and that is a real second implementation. Also not a smell when
a published API must stay stable for outside consumers.
