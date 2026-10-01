> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Mediator

**Family:** Behavioral

## Intent

Put many-to-many coordination in one object so the participants need not know each other.

## The smell it cures

[Inappropriate Intimacy](../smells/inappropriate-intimacy.md) among a group of components that all reference one another.

## Shape

Components talk only to the mediator; it decides who else needs to know.

## Why it earns its keep

Turns an N×N mesh into N edges, and puts the coordination rules in one readable place instead of distributing them.

## When NOT to reach for it

The mediator accumulates every rule in the system and becomes a [Large Class](../smells/large-class.md) — the coupling was centralised, not removed. If participants are few and stable, direct references are clearer.
