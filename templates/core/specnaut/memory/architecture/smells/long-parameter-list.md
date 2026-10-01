> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Long Parameter List

**Family:** Bloaters

## How to spot it

A signature with more parameters than a caller can order correctly without
looking. Watch for runs of same-typed parameters — those are the ones callers
transpose, and no type checker will notice.

## What it costs

Callers pass arguments positionally and get them wrong. Adding a parameter
edits every call site, which is [Shotgun Surgery](shotgun-surgery.md) waiting
to happen.

## Cure

[Introduce Parameter Object](../refactorings/introduce-parameter-object.md)
for parameters that travel together — they are usually a
[Data Clump](data-clumps.md). [Preserve Whole Object](../refactorings/preserve-whole-object.md)
when the caller already holds the thing you are unpacking.
[Replace Parameter with Method Call](../refactorings/replace-parameter-with-method-call.md)
when the callee can obtain the value itself.

## When it is NOT a smell

A pure function whose parameters are genuinely independent and unrelated —
bundling them into an object invents a concept nobody names, and the object
becomes a bag. Also fine when the language has named or keyword arguments and
the call sites read unambiguously.
