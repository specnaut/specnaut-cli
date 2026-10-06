# Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Backlog item**: [#N — title, as a link]

**This is the feature's one planning document.** Business and technical together, read whole by
whoever implements it. Filled in by `/specnaut plan`; the phase doc
(`phases/plan.md`) is the procedure, this file is the shape.

All twelve sections below are **mandatory**. Remove a section's placeholder text, never the
section. "Not applicable" is an answer worth writing down; an absent section is not.

---

## 1. Why this exists

[The problem in the user's own terms. Measure it where a measurement is available — a production
number beats a paragraph. Who is hurting, how often, and what it costs them today.]

## 2. User scenarios

[Prioritised journeys, each independently testable.]

### US1 — [name] (P1)

**Given** [starting state]
**When** [action]
**Then** [observable outcome]

### US2 — [name] (P2)

...

### Edge cases

- [What happens when …?]
- [What happens when …?]

## 3. Requirements

- **FR-001**: [Testable statement. If it quantifies over a set — "every", "all", "none anywhere" —
  say so plainly, and name the search that enumerates the set where you can.]
- **FR-002**: …

## 4. Success criteria

[Measurable, technology-agnostic, verifiable without implementation knowledge.]

- **SC-001**: [e.g. "Users complete checkout in under 3 minutes" — not "API response under 200ms",
  which is a technical detail wearing a criterion's clothes.]
- **SC-002**: …

## 5. 🔒 Decision table

<!--
  ACTION REQUIRED — THIS IS THE SECTION THE PLAN PHASE EXISTS FOR.
  One row per rule the feature introduces. Every requirement that IS a rule gets a row.
  - The home is a FILE PATH, never a layer. "the service layer" is not a home.
  - The third column is the one a reviewer greps for. Writing it is what makes you notice
    that a schema constraint and an application check are two spellings of one rule.
  - A rule with two genuine enforcement points names the ONE place the DECISION is made,
    and records that both ASK it. Two askers is fine; two deciders is the defect.
  BINDING ON THE IMPLEMENTER: a decision may not move out of its home without this table
  being amended first. A review finding that a decision has two homes is a plan violation.
-->

| The decision | Its single home | What would duplicate it |
| :--- | :--- | :--- |
| [the rule, in the user's words] | [one file path] | [the shapes a second spelling takes] |

## 6. Technical context

**Language/Version**: [e.g. Python 3.11, Swift 5.9, Rust 1.75 — or NEEDS CLARIFICATION]
**Primary Dependencies**: [e.g. FastAPI, UIKit, LLVM — or NEEDS CLARIFICATION]
**Storage**: [if applicable — or N/A]
**Testing**: [e.g. pytest, XCTest, cargo test — or NEEDS CLARIFICATION]
**Target Platform**: [e.g. Linux server, iOS 15+, WASM — or NEEDS CLARIFICATION]
**Project Type**: [e.g. library / cli / web-service / mobile-app / compiler / desktop-app]
**Performance Goals**: [domain-specific — or NEEDS CLARIFICATION]
**Constraints**: [domain-specific, e.g. <200ms p95, offline-capable — or NEEDS CLARIFICATION]
**Scale/Scope**: [domain-specific, e.g. 10k users, 50 screens — or NEEDS CLARIFICATION]

### Domain model

*Include where the feature has entities worth naming; write "no new entities" where it does not.*

- **Bounded context**: [the boundary this feature lives inside]
- **Vocabulary**: [the ubiquitous language — the words the code must use]
- **Entities** (have identity): [name — what identifies it, what it owns]
- **Value objects** (no identity): [name — what it represents]
- **Invariants**: [what must be true at all times, regardless of path]

## 7. Constitution check

*GATE: every principle gets a verdict before the plan is done.*

| Principle | Verdict | Note |
| :--- | :--- | :--- |
| Size limits (`## Size limits`, or the defaults in `.specnaut/memory/size-limits.md`) | pass / violation | [mandatory row — never removed] |
| [principle] | pass / violation | [why] |

### Files touched

*GATE: `Lines now` is measured with `wc -l` while writing this plan, never estimated. The plan is
not done while any file's lines after exceed its ceiling without shrinking, or a file already over
its target has lines after > lines now. The remedy is an extraction planned here, not a justification below.*

| File | Lines now | Lines after (est.) | Over target? | Responsibility of each new module (one line) |
| :--- | ---: | ---: | :--- | :--- |
| [path] | [wc -l] | [estimate] | yes / no | [new module — what it is responsible for] |

A responsibility that needs "and" to describe it is two responsibilities: split the module.

### Complexity tracking

[Any violation above, with the justification for accepting it. An unjustified violation means the
plan is not done. A size violation cannot be accepted here — it is fixed in the plan.]

## 8. Surface impact

[Every client surface this feature touches, and the interface contracts it exposes. "One surface
only" is a valid answer; an unstated one is not.]

| Surface | Touched? | What changes |
| :--- | :--- | :--- |
| [surface] | yes / no | [what] |

### Documentation (this feature)

```text
.specnaut/specs/[###-feature]/
├── plan.md    # This file — the whole plan
└── tasks.md   # `/specnaut tasks` output, derived from THIS file once approved
```

Two files. There is no `research.md`, `data-model.md`, `quickstart.md` or `contracts/` — where that
content matters it belongs in section 6 (domain model) or in the table above.

### Visual Prototyping with Claude Artifacts *(optional — front-end / UX-UI features only)*

<!--
  ACTION REQUIRED — CONDITIONAL SECTION.
  Keep this ONLY when the project has a front-end / UX-UI surface. Detect that surface with the
  SAME signal list the accessibility gate uses (see the `accessibility-expert` agent — do NOT invent a new
  heuristic). Any of:
    - `.html` / `.htm` files
    - `.jsx` / `.tsx` files
    - `.vue` / `.svelte` / `.astro` files
    - a `public/`, `src/app/`, `src/pages/`, `src/routes/` or `pages/` directory containing markup
    - a `package.json` listing a front-end framework dep (react, vue, svelte, solid-js, preact,
      lit, astro, @angular/core, qwik)
  If NONE of those signals are present, REMOVE this entire section — a back-end / CLI-only plan
  must not mention artifacts.
  Docs: https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-to-use-them
        https://code.claude.com/docs/en/artifacts
-->

[Which screens or states are worth prototyping as an artifact before implementation, and what
question the prototype is meant to answer.]

## 9. Risks

| Risk | Mitigation |
| :--- | :--- |
| [what could go wrong] | [what makes it not happen, or not matter] |

## 10. Architecture audit

*Findings from the `architect-expert` run against THIS document, before any code existed.*

| # | Finding | What was done |
| :--- | :--- | :--- |
| A1 | [finding] | [plan changed — how] / [objection accepted — why] |

**Verdict**: [the expert's conclusion, **with what it covered**. A clean verdict is worth exactly
what its coverage is worth, so name the coverage.]

## 11. Security audit

*Findings from the `security-expert` run against THIS document, in parallel with the architecture
audit. Kept separate on purpose — the two answer different questions.*

| # | Finding | What was done |
| :--- | :--- | :--- |
| S1 | [finding] | [plan changed — how] / [objection accepted — why] |

**Verdict**: [conclusion, with its coverage.]

## 12. Open questions

*Asked at the stop that ends the plan phase, and answered before any code exists.*

| Question | Answer | Date |
| :--- | :--- | :--- |
| [question] | [the settled decision] | [YYYY-MM-DD] |

### Decided without asking

[Anything you settled yourself because the code or a standing decision already answered it — one
line each, so a wrong assumption is visible rather than buried.]

- [assumption — and what made it safe]
