# Plan audits — architecture and security, against the plan

Loaded by `phases/plan.md` at step 6. Both audits run **before a single line of code is written**,
dispatched **in the same message** so they execute concurrently. They judge different things and
neither substitutes for the other.

**Both are read-only and advisory, and they are who settles the technical forks** — see "Who
decides" below. Their findings go **into `plan.md`**: either the plan changes, or it records why the
objection was accepted. An audit whose output is not written down did not happen. A clean verdict is written
down **with its coverage**, because a clean verdict is worth exactly what it covered.

## 🔒 The architecture audit

**Dispatch the `architect-expert` agent on `plan.md` before a single line is written** — here,
while changing your mind is still free, because architecture found at review time is architecture
rebuilt. The defect class it catches: a decision that must agree, spelled in more than one place, or
asked in a caller instead of at the decision. Ask four questions, in this order:

1. **Is the decision table complete?** Name any rule in the requirements with no row. A missing row
   is the defect this phase exists to prevent.
2. **Is each home the right home?** A pure rule belongs in its bounded context, not in a service; a
   decision asked by two gates belongs *in* the decision, not in either caller.
3. **What is the blast radius?** How many existing call sites, routes, components or surfaces does
   each new rule touch — **counted, not estimated.** This is where the cost hides: a gate described
   in one sentence can change the behaviour of two hundred routes.
4. **What would a reviewer find in this design three cycles from now?** In writing. A design whose
   predicted findings are already known can be corrected now, for the price of an edit.

## 🛡 The security audit

**Dispatch the `security-expert` agent on `plan.md` in the same message as the architecture audit**
so both run concurrently. Neither substitutes for the other: the architect asks whether a rule has
one home, the security seat asks whether that home is reachable by someone who should not reach it.
These are the most expensive findings to fix late — a missing authorization gate is one line, but a
data model that made the gate impossible is a migration, a backfill, and every caller. Ask four
questions, in this order:

1. **Which new surface accepts input, and where does it stop?** Every route, job, webhook and upload
   path the plan adds, and the validator that bounds it. A boundary with no validator named is the
   finding.
2. **Who is allowed, and where is that decided?** One authorization decision per new capability, at
   its home. Two gates for one rule, or a gate in a caller rather than at the decision, is the
   architect's defect class arriving through a different door.
3. **What identifiers and what bytes become reachable?** Enumerable ids, a path that skips its
   access check, a field that should never leave the server.
4. **What does this let an authenticated stranger do to somebody else's account?** In writing.
   "Nothing" is acceptable only when it names what was checked.

## ⚡ The performance seat — when the plan has a hot path

When the plan's technical context names a scale constraint, a hot path, a bulk job or a query over
an unbounded set, dispatch `performance-expert` on `plan.md` in the same message as the other two.
Ask what grows with the data, what runs per request, and what the plan does when the set is 100×
today's.

## ⚖ Who decides — the seats, not the user

Specnaut builds **long-lived** software: clean code, SOLID boundaries, sound design patterns, secure
by default. A technical fork is settled against that intent, not put to a vote:

- **Architecture, patterns, layering, naming, security hardening, performance trade-offs** — the
  seats rank the options, the plan takes the top one, and `plan.md` records it as a decision with
  the rejected alternatives and why. Presented at the plan stop as a report, **never asked**. Asking
  the user to confirm a recommendation an expert already made is a stop with nothing behind it.
- **When two seats disagree**, the reading better for the long-term health of the code wins:
  security, then maintainability, then performance, then speed of delivery. Record the conflict and
  the winner in `plan.md`.
- **Escalate to the user only** when the fork changes what the product does, or falls in the
  always-ask class of `phases/plan.md` step 8: the base branch, anything irreversible or
  destructive, breaking a public surface, a new external service, vendor or cost.

The same holds after the plan: a fix loop in `implement` or `review` never asks the user to choose
between technical fixes.
