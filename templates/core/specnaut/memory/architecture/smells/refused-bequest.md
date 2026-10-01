> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Refused Bequest

**Family:** Object-orientation abusers

## How to spot it

A subtype that inherits members it does not want — overriding them to throw,
to do nothing, or to return a value that means 'not applicable'.

## What it costs

Callers holding the supertype cannot rely on its contract, so they type-check
before calling. The hierarchy claims a substitutability it does not have,
which is a Liskov violation with a compiler that cannot see it.

## Cure

[Replace Inheritance with Delegation](../refactorings/replace-inheritance-with-delegation.md)
when the subtype wants the behaviour but not the contract. If several subtypes
refuse the same members, [Extract Interface](../refactorings/extract-interface.md)
for the part they all honour and let the rest live elsewhere.

## When it is NOT a smell

A deliberately abstract member the base declares precisely so subtypes must
supply it, and an optional hook with a documented no-op default. Both are the
mechanism working as intended — the refusal is a *surprise*, not a design.
