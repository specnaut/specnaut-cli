> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Primitive Obsession

**Family:** Bloaters

## How to spot it

Domain concepts carried as strings, numbers, or maps: an id that is a string
everywhere, a currency amount as a float, a status as a bare constant. The
tell is **validation repeated at every use site** — because there is no type
to put it in.

## What it costs

The rule that constrains the value lives everywhere the value is used, so it
is enforced inconsistently and silently drifts. Two different concepts with
the same primitive type are interchangeable to the compiler and to the reader.

## Cure

[Replace Data Value with Object](../refactorings/replace-data-value-with-object.md)
so the rule has one home. For a fixed set,
[Replace Type Code with Subclasses](../refactorings/replace-type-code-with-subclasses.md)
or [Replace Type Code with State/Strategy](../refactorings/replace-type-code-with-state-strategy.md).
Related: [Data Clumps](data-clumps.md).

## When it is NOT a smell

A primitive at a **boundary** — parsed from a request, read from a column,
about to be serialised. The wrapper belongs just inside the boundary, not on
the wire. Wrapping a value that has no rule attached to it and never will is
[Speculative Generality](speculative-generality.md).
