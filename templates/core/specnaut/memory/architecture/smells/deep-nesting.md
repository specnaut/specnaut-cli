> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Deep Nesting

**Family:** Structural

## How to spot it

Control flow indented past a few levels, usually guard conditions and loops
interleaved. Count nesting depth in the body rather than eyeballing the
indentation of the file.

## What it costs

The reader must hold every enclosing condition in mind to understand the
innermost line, and the number of paths through the function grows faster than
any test suite covers.

## Cure

[Replace Nested Conditional with Guard Clauses](../refactorings/replace-nested-conditional-with-guard-clauses.md)
to flatten the preconditions,
[Extract Method](../refactorings/extract-method.md) for whole inner blocks, and
[Decompose Conditional](../refactorings/decompose-conditional.md) to name the
tests.

## When it is NOT a smell

Nesting that mirrors a genuinely nested **structure** — walking a tree, parsing a
grammar, iterating a matrix. There the depth is the problem's, not the code's.
Flattening it with a state machine can easily be worse.
