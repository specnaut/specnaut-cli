> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Layer Violation

**Family:** Structural

## How to spot it

An import pointing the wrong way through the layering: domain reaching into
infrastructure, a use case importing a concrete adapter, any layer importing the
entry point. Detect the project's convention from its own structure before
judging — do not assume a naming scheme.

## What it costs

The dependency rule is the entire testability guarantee. Once inner code
depends on outer code, the inner code cannot be exercised without the outer
world, and swapping an implementation stops being possible.

## Cure

[Extract Interface](../refactorings/extract-interface.md) in the inner layer and
inject the implementation from outside — the port-and-adapter shape described in
[DDD and clean code](../ddd-and-clean-code.md).

## When it is NOT a smell

A **composition root** wiring concrete implementations together: it is the one
place that is allowed to know everything, and it must be outside the layers it
wires. Also not a violation when the project genuinely has no layering — say so
rather than importing a convention it never adopted.
