> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Lazy Class

**Family:** Dispensables

## How to spot it

A type that does not earn its existence — one field, one delegating method, or
whatever is left after a refactoring removed its reason to exist.

## What it costs

Every indirection is a hop the reader must take. A class that adds a name and no
behaviour makes navigation longer without making anything clearer.

## Cure

[Inline Class](../refactorings/inline-class.md), or
[Collapse Hierarchy](../refactorings/collapse-hierarchy.md) when a subtype has
stopped differing from its parent.

## When it is NOT a smell

A deliberately thin **boundary type** — a port interface with one method, a value
object wrapping one primitive to give it a rule and a name. Those are thin on
purpose: the value is in the type existing, not in its body. Also tolerate a
class that is currently thin because a planned second implementation is in the
same change.
