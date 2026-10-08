> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Parallel Inheritance Hierarchies

**Family:** Change preventers

## How to spot it

Every time you add a subtype in one hierarchy, you must add a matching one in
another. The two trees mirror each other, and the prefixes give it away.

## What it costs

A special case of [Shotgun Surgery](shotgun-surgery.md) with a name: the
compiler will not tell you the mirror is missing, so the trees drift and the
missing case surfaces as a runtime gap.

## Cure

[Move Method](../refactorings/move-method.md) and
[Move Field](../refactorings/move-field.md) to fold one hierarchy into the
other, so a single subtype carries both responsibilities. Where the second tree
is behaviour rather than data, [Visitor](../patterns/visitor.md) can remove the
need for it entirely.

## When it is NOT a smell

Two hierarchies that mirror each other **today** by coincidence and are expected
to diverge — for instance a domain model and a transport representation that are
deliberately decoupled. Merging those couples layers that were separated on
purpose.
