> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint `.claude/agents/architect-expert.md` and the catalogue
> README in the same change.

# Comments

**Family:** Dispensables

## How to spot it

A comment explaining *what* the code does, or apologising for it. The tell is a
comment that would be unnecessary if a name changed — 'check if user is
eligible' above an unnamed boolean expression.

## What it costs

The comment is not checked by anything, so it rots. A reader who trusts a stale
comment is worse off than one who read the code, and there is no test that
catches the divergence.

## Cure

[Extract Method](../refactorings/extract-method.md) and name it what the comment
said. [Rename Method](../refactorings/rename-method.md) where the name already
exists but lies. [Introduce Assertion](../refactorings/introduce-assertion.md)
where the comment states an assumption — an assertion is a comment the runtime
checks.

## When it is NOT a smell

A comment explaining **why** — a constraint from outside the code, a rejected
alternative, a link to the incident that motivated a strange branch. Code can
express what it does and never why it was chosen, so those comments are the only
place that knowledge exists. Deleting them destroys information; never flag
them.
