> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Observer

**Family:** Behavioral

## Intent

Let interested parties react to a subject's changes without the subject knowing who they are.

## The smell it cures

A subject that must call every interested party by name, edited each time one is added — [Shotgun Surgery](../smells/shotgun-surgery.md).

## Shape

The subject keeps a list of subscribers and notifies them on change.
Subscribers register and unregister themselves.

## Why it earns its keep

Adding a reaction touches no existing code, which is what makes domain events and reactive UIs tractable.

## When NOT to reach for it

Control flow becomes untraceable — with several observers the order is unspecified and a failure in one can silently affect others. Prefer an explicit call when there is one listener that must run. Always decide what happens when a subscriber throws; leaving it undefined is how this pattern hides failures.
