> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Shotgun Surgery

**Family:** Change preventers

## How to spot it

The inverse of [Divergent Change](divergent-change.md): one change forces small
edits across many files. The tell is a commit that touches ten files and adds
two lines to each.

## What it costs

Every such change is an opportunity to miss a site, and a missed site is a
silent behavioural divergence rather than a build failure. The cost grows with
the codebase, so it is worst exactly when it is hardest to fix.

## Cure

[Move Method](../refactorings/move-method.md) and
[Move Field](../refactorings/move-field.md) to pull the scattered pieces
together, then [Inline Class](../refactorings/inline-class.md) if what is left is
hollow. When the scattered thing is a decision rather than data, give the
decision one home — [Strategy](../patterns/strategy.md) behind a single injected
gate.

## When it is NOT a smell

A genuine cross-cutting rename or a mechanical migration performed with tool
support and verified by a build. The smell is a *recurring* need to edit many
sites, not a one-off sweep.
