# Developer agent doctrine — TDD / DDD / Boy-Scout-with-escalation

**Date:** 2026-05-15 **Status:** Approved design, ready for implementation plan **Scope:**
`templates/core/agents/developer.md`, `templates/core/agents/product-owner.md`, their
`plugin/agents/` mirrors, `constitution-template.md`, `spec-template.md`, three phase skills
(`specify`, `clarify`, `implement`)

---

## 1. Problem

The `developer` agent shipped by Specflow today gives senior-engineer-flavored advice
(TDD-if-infra-exists, Boy-Scout, no-silent-catches, doc-comments) but stops short of a real
engineering doctrine. It does not:

- Mandate TDD universally (it skips TDD when no test infra exists).
- Mandate a domain-driven layout for every change, even small ones.
- Define what to do when the Boy-Scout rule surfaces cleanup work too large to fit in the current
  PR.
- Spell out SOLID / DRY / KISS / YAGNI as enforceable principles.
- Require a Product-Owner-issued domain brief before any code is written.
- Distinguish front-end vs back-end pattern guidance.

The `product-owner` agent, symmetrically, has no contract for _describing the domain_ to the
developer, and no intake protocol for the tech-debt items the developer surfaces.

The user's goal: raise the engineering quality bar of every project Specflow scaffolds, across all
supported harnesses (Claude Code, Cursor, Codex, Gemini, Antigravity, OpenCode), by giving the
developer agent a stronger always-on doctrine and the PO a stronger contract toward the developer.

## 2. Solution shape (high level)

A two-axis change:

- **Always-on invariants** — TDD, DDD, Boy-Scout-with-escalation, SOLID/DRY/KISS/YAGNI,
  domain-brief-required, no-silent-catches — baked into the `developer.md` agent prompt. Same across
  every project.
- **Project-tunable specifics** — layer layout, back-end patterns (Repository, DI, controllers, …),
  front-end patterns (separation of view/logic, smart vs dumb components, …) — pre-populated in
  `constitution-template.md` so every new project starts opinionated, and editable so any project
  can deviate.

The Product Owner gains a mandatory `Domain Model` block in every brief (mirrored into `spec.md`
when there is a spec) and a tech-debt intake protocol that reads the developer's completion-report
`Tech debt surfaced` block and creates classified tickets.

Cross-harness propagation is already solved by Specflow's harness adapters and the template bundle.
Editing the canonical agent files is sufficient.

## 3. Changes by file

### 3.1 `templates/core/agents/developer.md` (and its `plugin/agents/developer.md` mirror)

Replace the existing "Non-negotiable rules" section with the doctrine below. Add an explicit step 0
to the protocol. Extend the completion report.

#### Doctrine (10 rules, always-on)

1. **Test-Driven Development (NON-NEGOTIABLE)** — write the failing test first, then the minimal
   implementation that makes it pass. If the project has no test infrastructure, bootstrap the
   language-idiomatic test runner (Vitest for TS/JS, Pytest for Python, JUnit for Java, `go test`
   for Go, `cargo test` for Rust, PHPUnit for PHP, etc.) as part of the task, and record it
   explicitly in the `Decisions` block of the completion report.

2. **Domain-Driven Design (NON-NEGOTIABLE)** — every change respects domain boundaries. Domain layer
   is pure (no I/O, no framework). Application layer holds use cases and ports. Infrastructure layer
   holds adapters. Presentation talks only to use cases. Specific layout comes from the
   constitution; cross-bounded-context bleed-through is forbidden.

3. **Domain brief required before any code** — read the `## Domain Model` block in `spec.md` (spec
   path) or in the PO's `/backlog brief` output (direct-implementation path). If the block is absent
   or empty, return **BLOCKED** with `awaiting:product-owner-domain-brief` — do not proceed.

4. **Boy Scout Rule with escalation**
   - _Small in-scope cleanup_ (≤ 1 file, ~15 lines diff, no public API change, no test churn): do it
     in the same PR, mention in `Decisions`.
   - _Larger out-of-scope cleanup_ (cross-cutting, needs its own design, would balloon the PR): log
     it under the `Tech debt surfaced` block of the completion report. The PO opens a tech-debt
     ticket from that list.

5. **SOLID / DRY / KISS / YAGNI** — apply SOLID (SRP, OCP, LSP, ISP, DIP). DRY only when duplication
   is semantic, not accidental similarity. KISS: smallest correct design. YAGNI: nothing the task
   does not need. Specific framework patterns (Repository, DI, hooks, etc.) come from the
   constitution.

6. **Smallest correct change** — no speculative abstractions.

7. **No silent catches** — every `catch` either logs at ERROR/WARN level or re-throws. Empty /
   comment-only `catch` blocks are forbidden.

8. **Respect the project constitution** — re-read when unsure.

9. **Run validation before handing off** — type-check + tests relevant to the change.

10. **In-code documentation** — doc-comments for business logic, domain rules, non-obvious design
    decisions, in the language-idiomatic format (JSDoc, docstrings, KDoc, PHPDoc, `///`, etc.).
    Focus on _why_, not _what_. Pure CRUD and self-evident utilities do not need doc-comments.

#### Protocol — new step 0 + existing flow

0. **Read the Domain Model brief** in `spec.md` or PO output. Refuse to proceed if absent.

(Existing steps 1–5 unchanged: confirm exit criteria → implement TDD → Boy Scout → validate →
completion report.)

#### Completion report (extended)

```
TASK <id or name>
Status: DONE | BLOCKED

Files changed
  - <path>

Decisions
  - <why X over Y>
  - (if applicable) Bootstrapped <test runner> because the project had no test infra

Validation run
  - <command>: <result>

Tech debt surfaced (Boy Scout — too big to fix in scope)
  - <one-liner> @ <path>:<line> — reason it's too big
  - (omit section entirely if empty)

Risks / follow-ups
  - …

Next owner
  - reviewer | qa | user | product-owner (if tech-debt items present)
```

### 3.2 `templates/core/agents/product-owner.md` (and its `plugin/agents/product-owner.md` mirror)

Three additions.

#### 3.2.1 — Mandatory `Domain Model` block in every brief

`/backlog brief <id>` always emits a `## Domain Model` section alongside the business brief. Schema:

```markdown
## Domain Model

**Bounded context:** <name>

**Vocabulary (Ubiquitous language):**

- <Term> — <one-line definition>

**Entities (have identity):**

- <Name> [aggregate root?] — <responsibility>

**Value objects (no identity, immutable):**

- <Name>(<fields>) — <invariant rule>

**Invariants (rules the domain must never break):**

- <rule> — <why>

**Out of scope (other bounded contexts touched but not owned here):**

- <other context> — <how this feature interacts with it>
```

If the task has a `spec.md`, the PO writes the block into the spec during `/specflow clarify` (the
spec template carries the same section — see §3.4). Otherwise, the block lives in the issue body and
in the `/backlog brief` output.

**Gate:** a brief without a Domain Model is not a valid brief. If the PO lacks information to
populate the block, it goes into clarify mode and asks the user — it does NOT emit a partial brief.

#### 3.2.2 — Tech-debt intake protocol

New internal protocol (no new slash command — it's an automatic behavior on dispatch). When the PO
is dispatched with a developer's completion report that contains a `Tech debt surfaced` block:

1. Parse each item (format: `<one-liner> @ <path>:<line> — reason`).
2. Search for duplicate open tickets via `gh issue list --search "<keyword>"` per item.
3. For non-duplicates, create a ticket with:
   - Issue Type: `Task`
   - Label: `tech-debt` + a domain label if obvious from the path
   - Size: PO's judgment, default `XS` or `S`
   - Priority: default `P3`, bumps to `P2` if the developer flagged a risk in the `reason`
   - Body: links the originating feature ticket ("Surfaced by #N during implementation") and copies
     the developer's one-liner + path/line as evidence
4. Report back with the list of created ticket numbers.

#### 3.2.3 — Domain ownership in grooming (soft gate)

Extend the existing classification contract with a fifth, _soft_ axis:

- **Bounded context** — every ticket has an identified business context, persisted as a
  `domain:<context>` label (e.g. `domain:checkout`, `domain:auth`).
- A ticket touching ≥ 2 bounded contexts triggers the existing epic-split heuristic with reason
  "cross-bounded-context".
- Single-context (mono-domain) projects may omit the label, but the brief MUST still carry
  `Bounded context: <unique-name>`.

This is intentionally a soft gate (label optional, brief field mandatory) to avoid breaking existing
Specflow projects already at 4-axis classification.

### 3.3 `templates/core/specflow/templates/constitution-template.md`

Add four pre-populated blocks. The user can amend, soften, or remove per principle — but a project
that overrides MUST document why.

#### 3.3.1 — `## Engineering methodology (Specflow baseline)`

- TDD (NON-NEGOTIABLE) — including bootstrap-when-missing.
- DDD (NON-NEGOTIABLE) — domain/application/infrastructure/presentation, no cross-context leakage.
- SOLID / DRY / KISS / YAGNI.
- Boy Scout Rule with escalation.

#### 3.3.2 — `## Architecture layers`

- `domain/` — pure types, entities, value objects, domain services.
- `application/` — use cases, ports, orchestration.
- `infrastructure/` — adapters (DB, HTTP, queues, filesystem, SDKs).
- `presentation/` — CLI, web routes, controllers, UI shells.
- Each bounded context gets its own subtree: `domain/<context>/`, etc.

#### 3.3.3 — `## Back-end patterns`

- Repository pattern per aggregate root.
- Service objects / use cases — one class per use case, verb-named.
- Dependency injection through constructors; no service locators, no globals.
- Thin controllers — translate transport ↔ use case.
- Errors are domain types; HTTP/SQL errors never reach the domain.
- Pure domain — no logging, no metrics, no clocks inside `domain/`.

#### 3.3.4 — `## Front-end patterns`

- Separation of view and logic — components render; logic in hooks/composables/services.
- No business rules in templates — derive in hooks, render the result.
- Smart vs dumb components — presentational stay pure; containers hold state/effects.
- Single source of truth for cross-cutting state (typed store or context).
- API access through a typed client / repository layer; never raw `fetch` in components.
- Accessibility non-optional — semantic HTML, keyboard paths, visible focus.

### 3.4 `templates/core/specflow/templates/spec-template.md`

Add a new top-level `## Domain Model *(mandatory)*` section between `## Requirements` and
`## Success Criteria`. Schema is identical to §3.2.1 — the developer reads the same shape whether it
comes from `spec.md` or from a `/backlog brief`.

Trim the existing `### Key Entities` sub-section to a short pointer back to the new top-level Domain
Model section (keeps backward visibility, removes duplication).

### 3.5 `templates/core/skills/specflow/phases/specify.md`

Step 7 currently reads "Identify Key Entities (if data involved)". Replace with: "**Populate the
`## Domain Model` block (mandatory)** — Bounded context, Vocabulary, Entities, Value Objects,
Invariants, Out of scope. Use `[NEEDS CLARIFICATION]` markers if the input is insufficient —
`/specflow clarify` will resolve them."

### 3.6 `templates/core/skills/specflow/phases/clarify.md`

The current checklist already lists "Domain & Data Model (entities, identity, lifecycle, scale)"
among the areas to clarify. Promote it from a checklist item to an **exit gate**: clarify cannot
mark the spec ready if the `## Domain Model` section still contains placeholders or
`[NEEDS CLARIFICATION]` markers.

### 3.7 `templates/core/skills/specflow/phases/implement.md`

First step of the developer's pipeline becomes: "Read `## Domain Model` from `spec.md`. If absent or
incomplete → BLOCKED, request PO clarification before any code." This mirrors developer.md doctrine
rule #3, but inside the orchestration skill so the workflow-manager enforces it too.

## 4. Cross-harness propagation

**Automatic.** Specflow's existing harness adapters render the canonical agent files into
per-harness locations:

- Claude: `.claude/agents/<name>.md`
- Codex: `.codex/agents/<name>.toml` + skill rendering at `.agents/skills/specflow-agent-<name>/`
- Cursor: skill folders at `.cursor/skills/specflow-agent-<name>/`
- Gemini: `.gemini/agents/<name>.md`
- Antigravity: `.agent/agents/specflow-<name>.md`
- OpenCode: `.opencode/agents/specflow-<name>.md`

The pre-commit hook regenerates `src/templates_bundle.ts` from `templates/core/`. The
`plugin/agents/` files ship via the Claude Code plugin marketplace and must remain byte-identical to
their `templates/core/agents/` counterparts.

## 5. Backward compatibility

| Surface                    | New project (`specflow init`) | Existing project (`specflow upgrade`)                                                                                                                                                               |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `developer.md` agent       | Receives full new doctrine    | Receives full new doctrine (re-bundled)                                                                                                                                                             |
| `product-owner.md` agent   | Receives new contract         | Receives new contract (re-bundled)                                                                                                                                                                  |
| `constitution-template.md` | New baseline blocks present   | Constitution is user-owned, NOT re-written by `upgrade`. Users must rebase their constitution against the new baseline manually if they want the blocks. To be called out in the release changelog. |
| `spec-template.md`         | New Domain Model section      | Re-bundled (lives under `.specflow/templates/`)                                                                                                                                                     |
| Phase skills               | New behavior                  | Re-bundled                                                                                                                                                                                          |

Existing in-flight features (`spec.md` already created) keep their current shape — they predate the
Domain Model section. The developer agent's rule #3 (refuse if absent) only triggers for specs
created after the upgrade, because pre-upgrade specs don't have the section header at all. Realistic
transition: the workflow-manager will surface a BLOCKED report on the next implement of an old spec,
the user clarifies, and from then on every new spec is well-formed.

## 6. Risks and mitigations

| Risk                                                             | Mitigation                                                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrapping test infra surprises users who didn't ask          | Developer mentions it explicitly in `Decisions` (rule #1). Always transparent, never silent.                                                                           |
| DDD enforcement burdensome on tiny projects                      | The constitution baseline blocks are tunable. Single-context projects ship a one-context Domain Model. The rule is about _boundaries_, not about minimum folder depth. |
| Existing specs without Domain Model break the implement pipeline | Workflow-manager surfaces a BLOCKED report; PO clarifies; the user fixes the spec once. Documented in the release changelog.                                           |
| `Tech debt surfaced` block parsing brittle                       | One-liner-per-line format is grep-friendly. The PO is allowed to fall back to clarifying with the user if a line is ambiguous.                                         |
| `domain:*` labels proliferate                                    | Soft gate — label optional. Brief field mandatory. Users only see labels for projects they explicitly multi-domain.                                                    |
| Cross-harness rendering misses a new file                        | All 9 files live under paths already wired into `bundle-templates.ts` / harness adapters. No new bundling logic needed.                                                |

## 7. Validation plan

1. `deno fmt --check` + `deno lint` + `deno task bundle` + `deno check` (pre-commit hook).
2. `deno task test` — the 196 existing tests must stay green. Content-only changes carry minimal
   regression risk.
3. Sandbox validation via `scripts/test-sandbox`:
   - `specflow init` on a fresh sandbox project
   - Verify the rendered `.claude/agents/developer.md` contains the new doctrine
   - Verify `.specflow/templates/spec-template.md` contains the Domain Model section
   - Verify `.specflow/memory/constitution.md` (template-derived) contains the four new baseline
     blocks
   - Repeat for `--ai cursor` and `--ai codex` to confirm cross-harness rendering
4. Spot-check: run `/specflow specify "<small feature>"` end-to-end and confirm the produced spec
   carries a populated Domain Model section.

## 8. Out of scope (deliberately)

- Per-language test-runner detection logic (the developer infers it from the project — no detection
  code shipped in the binary).
- Automatic constitution rebase on `specflow upgrade` (constitution is user-owned; rebase stays
  manual).
- Adding a `/backlog intake-tech-debt` explicit slash command (it is internal PO behavior triggered
  by dispatch).
- New native Project field for Bounded context (kept as a `domain:*` label to avoid forcing a
  Project schema migration).
- Code-reviewer agent updates (the existing rules already cover DRY / layer violations; the doctrine
  reinforces upstream and the reviewer remains as-is).

## 9. Files touched (final)

1. `templates/core/agents/developer.md`
2. `plugin/agents/developer.md` (mirror)
3. `templates/core/agents/product-owner.md`
4. `plugin/agents/product-owner.md` (mirror)
5. `templates/core/specflow/templates/constitution-template.md`
6. `templates/core/specflow/templates/spec-template.md`
7. `templates/core/skills/specflow/phases/specify.md`
8. `templates/core/skills/specflow/phases/clarify.md`
9. `templates/core/skills/specflow/phases/implement.md`

Plus auto-regenerated: `src/templates_bundle.ts` (pre-commit hook).
