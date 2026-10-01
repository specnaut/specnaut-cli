> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Alternative Classes with Different Interfaces

**Family:** Object-orientation abusers

## How to spot it

Two types doing the same job with different names, orders, or shapes for the
same operations. Usually the result of two teams, two eras, or a vendor swap
that was never finished.

## What it costs

Callers cannot be written against either one, so the choice leaks into every
call site and no substitution is possible — including in tests.

## Cure

[Rename Method](../refactorings/rename-method.md) and
[Move Method](../refactorings/move-method.md) to converge the shapes, then
[Extract Interface](../refactorings/extract-interface.md). Where one side is
external and cannot be changed, [Adapter](../patterns/adapter.md) is the
correct answer rather than a rewrite.

## When it is NOT a smell

Two types that look similar but answer different questions, where the
similarity is in the vocabulary rather than the responsibility. Unifying those
produces an interface that satisfies neither caller — see
[Duplicate Code](duplicate-code.md) for the same trap at method level.
