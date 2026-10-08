> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Implicit Global

**Family:** Structural

## How to spot it

Code that should be pure reaching for ambient state: the clock, the filesystem,
the network, environment variables, random numbers, process globals, or a
singleton registry.

## What it costs

The function's result depends on something its signature does not mention. Tests
become order-dependent and flaky, and behaviour differs between environments for
reasons no reader can see.

## Cure

Inject it. Pass the value, or depend on a port —
[Extract Interface](../refactorings/extract-interface.md) plus
[Replace Constructor with Factory Method](../refactorings/replace-constructor-with-factory-method.md)
where construction is the problem. A clock and a random source are dependencies
like any other.

## When it is NOT a smell

Ambient access in the **outer** layer whose job is exactly that — the entry
point, an adapter, a configuration loader. The rule is about where the access
happens, not that it happens; something must eventually touch the world.
