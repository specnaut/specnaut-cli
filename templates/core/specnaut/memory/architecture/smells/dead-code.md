> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Dead Code

**Family:** Dispensables

## How to spot it

Code no execution path reaches: an unreferenced function, a branch whose
condition cannot hold, a parameter nobody passes, a flag never set. Confirm
reachability rather than assuming it — dynamic dispatch, reflection, and
configuration can call things a grep cannot see.

## What it costs

Readers pay to understand it and maintainers pay to keep it compiling. Worse, it
makes the codebase look like it supports something it does not.

## Cure

Delete it. Version control is the archive; a commented-out block or a
permanently-false flag is a worse archive than the history. Where a parameter
survives for signature compatibility,
[Remove Parameter](../refactorings/remove-parameter.md).

## When it is NOT a smell

Code reached only through a mechanism your search does not model — a plugin
registry, a serialiser, a framework hook, a public API consumed outside this
repository. **Prove unreachability before flagging**, and say how you proved it;
an unproven claim here causes deletions that break consumers.
