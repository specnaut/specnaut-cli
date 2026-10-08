> **Agents depend on this file.** The architect is required to open it before
> naming this smell in a report. Moving or renaming it breaks that link in
> silence — repoint the `architect-expert` agent and the catalogue
> README in the same change.

# Switch Statements

**Family:** Object-orientation abusers

## How to spot it

A branch on a type code, role, tier, provider, or mode — and the **same**
branch appearing in more than one place. One switch is a decision; the same
switch repeated is a missing abstraction.

## What it costs

Adding a case means finding every copy. The copies drift, so behaviour
depends on which path the caller took, and the divergence is invisible until
someone reports it as a bug.

## Cure

[Replace Conditional with Polymorphism](../refactorings/replace-conditional-with-polymorphism.md),
or [Replace Type Code with State/Strategy](../refactorings/replace-type-code-with-state-strategy.md)
where the case set is behavioural. The design-level answer is usually
[Strategy](../patterns/strategy.md) resolved once and injected — one gate, not
five.

## When it is NOT a smell

A single switch at a **boundary** whose whole job is to dispatch: a parser
mapping tokens, a factory selecting an implementation, a router. That switch
is the seam where the polymorphism is created, and it has to exist somewhere.
The smell is the *second* copy of it.
