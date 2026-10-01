> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Feature Envy

**Family:** Couplers

## How to spot it

A method more interested in another object's data than its own — it reaches
across for several fields and computes something from them. Count the accesses:
if most are to the other object, the method is in the wrong place.

## What it costs

The rule ends up far from the data it constrains, so a change to the data's
representation reaches into a module that had no business knowing it.

## Cure

[Move Method](../refactorings/move-method.md), or
[Extract Method](../refactorings/extract-method.md) first if only part of the
body is envious.

## When it is NOT a smell

A deliberate **orchestrator** — a use case, a service, a controller — whose job
is to use its collaborators. Coordination is not envy. The distinction is
whether the method makes a *decision* that belongs to the other object, or
merely sequences calls.
