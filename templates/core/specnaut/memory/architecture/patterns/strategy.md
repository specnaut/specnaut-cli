> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Strategy

**Family:** Behavioral

## Intent

Define a family of interchangeable behaviours behind one interface and let the caller receive the one it needs.

## The smell it cures

[Switch Statements](../smells/switch-statements.md) on role, tier, provider, flag or mode — especially the same switch repeated across files.

## Shape

One interface, one implementation per behaviour, injected at the composition
root. Every scattered conditional collapses into a single call to the injected
strategy.

## Why it earns its keep

The recurring answer to conditional logic spread across call sites. Adding a case is a new implementation, not edits across N files, and the decision gets exactly one home — so it cannot be asked inconsistently. State what becomes impossible afterwards: not 'the code is cleaner', but 'this rule can no longer be answered two different ways, because there is one gate rather than five'.

## When NOT to reach for it

Only one behaviour exists and no second is in sight — a single-implementation interface is [Speculative Generality](../smells/speculative-generality.md). Also avoid when the branches are one line each and live in one place: [Decompose Conditional](../refactorings/decompose-conditional.md) is the smaller cure, and the smallest cure that removes the smell is the right one.
