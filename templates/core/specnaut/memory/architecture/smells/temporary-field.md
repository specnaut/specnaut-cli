> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Temporary Field

**Family:** Object-orientation abusers

## How to spot it

A field that is only meaningful during part of the object's life — set by one
method, read by another, meaningless otherwise. Often paired with null checks
that ask 'has this been populated yet'.

## What it costs

The object has states the type does not describe, so every reader must
reconstruct the protocol by reading the methods in order. Nulls leak outward
as defensive checks in callers.

## Cure

[Extract Class](../refactorings/extract-class.md) for the fields that belong
to one phase, so the phase becomes an object with a complete lifetime.
[Introduce Special Case](../refactorings/introduce-special-case.md) where the
null is standing in for a real case, and
[Replace Method with Method Object](../refactorings/replace-method-with-method-object.md)
when the field only exists to pass state between helpers.

## When it is NOT a smell

A genuine memoisation or cache field, where the empty state means 'not
computed yet' and is invisible to callers. That is an implementation detail
with a real invariant, not an undescribed state.
