> **Agents depend on this file.** The architect is required to open it — and to
> read "When NOT to reach for it" — before prescribing this pattern. Moving or
> renaming it breaks that link in silence.

# Flyweight

**Family:** Structural

## Intent

Share the invariant part of many similar objects to cut memory.

## The smell it cures

Memory pressure from large numbers of objects that mostly hold identical data.

## Shape

Split state into intrinsic (shared, immutable) and extrinsic (passed in per
call). A cache hands out shared intrinsic instances.

## Why it earns its keep

Only when measured. It trades clarity for footprint, and that trade is worth it exactly when the footprint is a demonstrated problem.

## When NOT to reach for it

You have not measured. This is the pattern most often applied to an imaginary problem; without a profile it makes the object model harder for nothing. Immutability of the shared part is a hard requirement — sharing mutable state is a defect.
