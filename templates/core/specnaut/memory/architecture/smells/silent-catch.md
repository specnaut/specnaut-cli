> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Silent Catch

**Family:** Structural

## How to spot it

A caught error that is neither logged, re-thrown, nor turned into a value the
caller can act on. Includes an empty handler, one that logs at debug level and
continues, and one that returns a default indistinguishable from success.

## What it costs

The system continues in a state the author never designed for, and the
diagnostic evidence is destroyed at the exact point it existed. The failure
resurfaces later, somewhere unrelated, with no trace back to the cause. Treat
this as the highest-severity structural finding: it does not merely hide a bug,
it removes the ability to find one.

## Cure

Decide what the failure *means* and encode it: re-throw with context, return an
explicit failure value the caller must handle, or handle it fully and log at a
level that will actually be seen.
[Replace Error Code with Exception](../refactorings/replace-error-code-with-exception.md)
and its inverse both apply, depending on which direction the codebase uses.

## When it is NOT a smell

A catch that **fully handles** the case and says so — a documented fallback, an
optional lookup where absence is a legitimate answer, a cleanup path that must
not mask the original failure. The test is whether the author decided what the
error means, or merely stopped it from propagating.
