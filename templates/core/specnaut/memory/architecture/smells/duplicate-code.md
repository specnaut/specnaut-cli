> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Duplicate Code

**Family:** Dispensables

## How to spot it

The same logic in more than one place. Distinguish two kinds: identical code in
sibling subtypes, and similar-looking code in unrelated modules. Only the first
is reliably a defect.

## What it costs

A fix applied to one copy and not the others produces divergent behaviour that
no type checker sees. The copies also drift under unrelated edits until unifying
them is no longer possible.

## Cure

[Extract Method](../refactorings/extract-method.md) within a type;
[Pull Up Method](../refactorings/pull-up-method.md) across siblings;
[Form Template Method](../refactorings/form-template-method.md) when the steps
match but the details differ. Where the duplication is in the *shape* of a
conditional,
[Consolidate Conditional Expression](../refactorings/consolidate-conditional-expression.md).

## When it is NOT a smell

**Coincidental similarity.** Two pieces of code that look alike but answer to
different owners and will change for different reasons. Unifying them creates a
shared abstraction that both callers then fight, and the next change adds a flag
to it. Respect the Rule of Three, and prefer duplication to the wrong
abstraction.
