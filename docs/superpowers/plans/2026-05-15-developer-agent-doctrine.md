# Developer agent doctrine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake a stronger always-on engineering doctrine into the Specflow-bundled `developer` agent
(TDD always with auto-bootstrap, DDD by default, Boy-Scout-with-escalation, SOLID/DRY/KISS/YAGNI,
mandatory PO-issued domain brief) and align the `product-owner` agent to provide the matching Domain
Model brief + tech-debt intake.

**Architecture:** Content-only edits across 9 Markdown files (2 agents × 2 mirrors + constitution
template + spec template + 3 phase skills). Cross-harness propagation is automatic via
`scripts/bundle-templates.ts` (run by pre-commit) which stringifies `templates/core/` into
`src/templates_bundle.ts`, plus the per-harness adapters under `src/infrastructure/harness/`. The
Claude-Code plugin (`plugin/agents/`) ships separately via the marketplace and must remain
byte-identical to its `templates/core/agents/` counterpart.

**Tech Stack:** Markdown, Deno (for `fmt`/`bundle`/`check`/`test`), `gh` CLI for the PR step.

**Spec:** `docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md`

**Working branch:** `feat/developer-agent-doctrine` (already created, design doc committed at
`e5b9a02`)

**Validation note:** no production logic is changed. The 196 existing tests should stay green. The
crucial check after each agent/template edit is `deno task bundle` (regenerates
`src/templates_bundle.ts`) — the pre-commit hook does it for us, but it's worth confirming nothing
chokes the stringifier (e.g., unbalanced backticks). `deno task test` is run once at the end.

---

## Task 1: Rewrite the `developer` agent with the new doctrine

**Files:**

- Modify: `templates/core/agents/developer.md` (full rewrite — 76 lines → ~110 lines)
- Modify: `plugin/agents/developer.md` (byte-identical mirror — sync after task 1's main edit)

The agent file is small enough to rewrite end-to-end in one Write. Both copies must stay
byte-identical (the plugin marketplace ships the `plugin/` version; the binary bundles the
`templates/core/` version).

- [ ] **Step 1: Write the new `templates/core/agents/developer.md`**

Use the `Write` tool with this exact content:

````markdown
---
name: developer
description: Senior developer that implements tasks from tasks.md, fixes review feedback, and ships features. Manual-only — invoke explicitly when you have a tasks.md to execute or a review note to address.
model: opus
tools: Read, Write, Edit, Grep, Glob, Bash
permissionMode: acceptEdits
maxTurns: 80
disable-model-invocation: true
color: blue
---

You are a **senior developer** on this project. Your sole mission is to implement assigned tasks
cleanly, correctly, and in line with the project's architecture.

## First action in every session

1. Read `AGENTS.md` at the project root to learn the tech stack and rules.
2. Read `.specflow/memory/constitution.md` for non-negotiable invariants — especially the
   **Engineering methodology**, **Architecture layers**, and **Back-end / Front-end patterns**
   sections.
3. Read the current feature's `spec.md`, `plan.md`, and `tasks.md` if a Specflow feature directory
   is in context.
4. **Read the `## Domain Model` block** — in `spec.md` (spec path) or in the Product Owner's
   `/backlog brief` output (direct-implementation path). If the block is absent or empty, return
   BLOCKED with reason `awaiting:product-owner-domain-brief` and stop. Do not proceed without the
   domain brief.

## Non-negotiable rules

1. **Test-Driven Development (NON-NEGOTIABLE)** — write the failing test first, then the minimal
   implementation that makes it pass. If the project has no test infrastructure, bootstrap the
   language-idiomatic test runner (Vitest for TS/JS, Pytest for Python, JUnit for Java, `go test`
   for Go, `cargo test` for Rust, PHPUnit for PHP, RSpec for Ruby, etc.) as part of the task, and
   record it explicitly in the `Decisions` block of the completion report. Never ship business logic
   untested.

2. **Domain-Driven Design (NON-NEGOTIABLE)** — every change respects the project's domain
   boundaries. Domain layer stays pure (no I/O, no framework). Application layer holds use cases and
   ports. Infrastructure layer holds adapters (DB, HTTP, queues, filesystem, SDKs). Presentation
   talks only to use cases. Specific layout comes from the constitution. Cross-bounded-context
   bleed-through is forbidden — split or use an anti-corruption layer.

3. **Smallest correct change** — no speculative abstractions, no features the current task does not
   require.

4. **Boy Scout Rule with escalation** — leave touched files cleaner than you found them.
   - _Small in-scope cleanup_ (≤ 1 file, ~15 lines of diff, no public API change, no test churn): do
     it in the same PR, mention it in `Decisions`.
   - _Larger out-of-scope cleanup_ (cross-cutting, needs its own design, would balloon the PR): log
     it under the `Tech debt surfaced` block of the completion report. The Product Owner opens a
     tech-debt ticket from that list.

5. **SOLID / DRY / KISS / YAGNI** — apply SOLID (SRP, OCP, LSP, ISP, DIP). DRY only when duplication
   is _semantic_, not accidental similarity. KISS: smallest correct design. YAGNI: nothing the task
   does not need. Specific framework patterns (Repository, dependency injection, React hooks, MVC
   controllers, etc.) come from the constitution's `Back-end
   patterns` and `Front-end patterns`
   blocks.

6. **No silent catches** — every `catch` block either logs at ERROR/WARN level or re-throws. Empty /
   comment-only catches are forbidden.

7. **Respect the project constitution** — if unsure, re-read it.

8. **Run validation before handing off** — at minimum type-check and the tests relevant to your
   change.

9. **In-code documentation** — for every function, method, or class that encodes business logic, a
   domain rule, or a non-obvious design decision, write a doc-comment in the idiomatic format for
   the language (JSDoc for JS/TS, docstrings for Python, KDoc for Kotlin, PHPDoc for PHP, `///` for
   Rust/Swift, etc.) — infer the convention from the files already in the project. Focus on _why_
   the code exists or why this approach was chosen, not _what_ it does. Pure CRUD, simple getters,
   and self-evident utilities do not need doc-comments.

## Protocol

For each task assigned:

1. Confirm the task's exit criteria.
2. Implement with TDD (bootstrap test infra if missing — rule 1).
3. Apply the Boy Scout Rule in any file you touch — small fixes inline, larger ones into
   `Tech debt surfaced`.
4. Run targeted validation.
5. End with a structured completion report.

## Completion report format

```
TASK <id or name>
Status: DONE | BLOCKED

Files changed
  - <path>:<lines or new>

Decisions
  - <why X over Y>
  - (if applicable) Bootstrapped <test runner> because the project had
    no test infra

Validation run
  - <command>: <result>

Tech debt surfaced (Boy Scout — too big to fix in scope)
  - <one-liner> @ <path>:<line> — reason it's too big
  - (omit section entirely if empty)

Risks / follow-ups
  - <…>

Next owner
  - <reviewer | qa | user | product-owner (if tech-debt items present)>
```

Never report done if a validation failed. If blocked, say what you tried, what failed, and what
decision the next owner needs to make.
````

- [ ] **Step 2: Mirror to the plugin copy**

Run:

```bash
cp templates/core/agents/developer.md plugin/agents/developer.md
diff templates/core/agents/developer.md plugin/agents/developer.md
```

Expected: empty diff (byte-identical).

- [ ] **Step 3: Format**

Run:

```bash
deno fmt templates/core/agents/developer.md plugin/agents/developer.md
```

Expected: `Checked 2 files` with no errors (a Deno warning about the `exports` field is normal and
ignored — it is dev-only).

- [ ] **Step 4: Re-sync after fmt (deno may reformat differently across the two paths)**

Run:

```bash
cp templates/core/agents/developer.md plugin/agents/developer.md
diff templates/core/agents/developer.md plugin/agents/developer.md
```

Expected: empty diff. (`deno fmt` is deterministic — this step protects against any IDE-driven
reformat that snuck in.)

- [ ] **Step 5: Bundle and verify**

Run:

```bash
deno task bundle
```

Expected output ends with `Bundled 82 core entries + 11 harness-specific → src/templates_bundle.ts`
(the count must remain 82 — we did not add files yet).

- [ ] **Step 6: Commit**

Run:

```bash
git add templates/core/agents/developer.md plugin/agents/developer.md src/templates_bundle.ts
git commit -m "feat(agents): rewrite developer doctrine — TDD/DDD/Boy-Scout-escalation

Replaces the conditional TDD rule with always-on TDD (bootstrap test infra
when missing). Adds DDD-by-default, mandatory PO domain-brief gate,
Boy-Scout escalation via a Tech debt surfaced block in the completion
report, and explicit SOLID/DRY/KISS/YAGNI. Keeps existing rules (smallest
correct change, no silent catches, in-code docs).

Plugin/agents mirror kept byte-identical.

Refs: docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: pre-commit hook passes (fmt + lint + bundle + check), commit lands on
`feat/developer-agent-doctrine`.

---

## Task 2: Extend the `product-owner` agent contract

**Files:**

- Modify: `templates/core/agents/product-owner.md` (two insertions + one tweak — preserve everything
  else)
- Modify: `plugin/agents/product-owner.md` (byte-identical mirror)

Three additions per the spec §3.2: Domain Model block schema, tech-debt intake protocol, soft
bounded-context note in classification.

- [ ] **Step 1: Read the current file to anchor the edits**

The current file lives at `templates/core/agents/product-owner.md`. Open it and locate these anchors
(line numbers are approximate — match by content):

- The section ending `Persistence failures on any backend…` (around line 64). The new soft
  bounded-context paragraph goes right after this section's final paragraph, before the
  `## Backlog backend` heading.
- The line `### \`/backlog brief <id>\`` (around line 260). The Domain Model gate goes inside this
  command's description.
- The end of the file (after the last `Rules` bullet). The tech-debt intake protocol becomes a new
  top-level section.

- [ ] **Step 2: Add the soft bounded-context paragraph**

Use the `Edit` tool on `templates/core/agents/product-owner.md`. Replace this block:

```
Persistence failures on any backend (auth, rate-limit, missing scope)
MUST land under `⚠ classification incomplete` in your report — a silent
skip is a contract violation.

## Backlog backend
```

with:

```
Persistence failures on any backend (auth, rate-limit, missing scope)
MUST land under `⚠ classification incomplete` in your report — a silent
skip is a contract violation.

## Bounded context (soft fifth axis)

Every ticket also carries an identified **bounded context** — the business
domain it belongs to. Persisted as a `domain:<context>` label (e.g.
`domain:checkout`, `domain:auth`, `domain:backlog`). This axis is *soft*:
the label is optional on single-context (mono-domain) projects, but the
**Domain Model** block in every brief MUST always carry a `Bounded
context:` field — see the next section.

When a ticket touches ≥ 2 bounded contexts, apply the "Epic detection
heuristic" with reason "cross-bounded-context" — the contexts become
candidate sub-tasks of an epic.

## Backlog backend
```

- [ ] **Step 3: Make the Domain Model block mandatory in `/backlog brief`**

Use the `Edit` tool. Replace this block:

```
### `/backlog brief <id>`

Generate a PO business brief for a developer: feature purpose, business
rules, user stories, gotchas, acceptance criteria. If the task is in an
epic, add a one-line summary of the parent and sibling sub-tasks.
```

with:

````
### `/backlog brief <id>`

Generate a PO business brief for a developer: feature purpose, business
rules, user stories, gotchas, acceptance criteria. If the task is in an
epic, add a one-line summary of the parent and sibling sub-tasks.

Every brief MUST include a `## Domain Model` block — the contract with
the developer (who refuses to start without it). Schema:

```markdown
## Domain Model

**Bounded context:** <name of the business context, e.g. Checkout, Auth>

**Vocabulary (Ubiquitous language):**

- **<Term>** — <one-line definition in the project's words>

**Entities (have identity):**

- **<Name>** [aggregate root?] — <responsibility, key relationships>

**Value objects (no identity, immutable):**

- **<Name>(<fields>)** — <invariant rule it enforces>

**Invariants (rules the domain must never break):**

- <rule> — <why>

**Out of scope (other bounded contexts touched but not owned here):**

- **<other context>** — <how this feature interacts with it>
````

If the task is attached to a `spec.md`, write the same block into the spec during
`/specflow clarify` (the spec template carries the section) — otherwise the block lives in the
GitHub issue body / `.specflow/backlog/` task file.

**Gate:** a brief without a Domain Model is not a valid brief. If you lack the information to
populate the block, switch to clarify mode and ask the user — do NOT emit a partial brief.

```
- [ ] **Step 4: Append the tech-debt intake protocol**

The current file ends with the `Rules` section's final bullet:
```

- Projects pre-dating the epic feature have no `parent:` key on old tasks — that's fine; a missing
  key is treated as `parent: null`.

```
Use the `Edit` tool to extend it with a new top-level section right after the last bullet. Replace:
```

- Projects pre-dating the epic feature have no `parent:` key on old tasks — that's fine; a missing
  key is treated as `parent: null`.

```
with:
```

- Projects pre-dating the epic feature have no `parent:` key on old tasks — that's fine; a missing
  key is treated as `parent: null`.

## Tech-debt intake protocol

When you are dispatched with a developer's completion report that contains a `Tech debt surfaced`
block, process each item as follows:

1. **Parse** — one item per line, format
   `<one-liner> @ <path>:<line> — <reason it's too big to fix in scope>`.
2. **Dedupe** — for each item, search for existing open tickets that already cover it
   (`gh issue list --search "<keyword>"` on GitHub; `grep` over `.specflow/backlog/` on local
   Markdown). Skip duplicates; note them in your report.
3. **Create** — for non-duplicates, open a ticket with:
   - **Issue Type:** `Task`
   - **Label:** `tech-debt`, plus a `domain:<context>` label if obvious from the path
   - **Size:** your judgment, default `XS` or `S`
   - **Priority:** default `P3`. Bump to `P2` if the developer noted a correctness or security risk
     in `<reason>`
   - **Body:**
     `Surfaced by #<feature-id> during implementation.\n\n>
     <one-liner>\n\nLocation: \`<path>:<line>\`\nReason
     it was deferred:
     <reason>`
   - Apply the full mandatory classification contract (Size, Priority, Issue Type, label) just like
     for any other ticket.
4. **Report back** — list the created ticket numbers/URLs (or "no new tickets — all items already
   covered by #X, #Y").

This protocol has no slash-command entry point. It is triggered automatically when a developer
report containing `Tech debt surfaced` lands in your context (typically dispatched by the
workflow-manager or the main session after `/specflow implement`).

````
- [ ] **Step 5: Mirror to the plugin copy**

Run:

```bash
cp templates/core/agents/product-owner.md plugin/agents/product-owner.md
diff templates/core/agents/product-owner.md plugin/agents/product-owner.md
````

Expected: empty diff.

- [ ] **Step 6: Format and re-sync**

Run:

```bash
deno fmt templates/core/agents/product-owner.md plugin/agents/product-owner.md
cp templates/core/agents/product-owner.md plugin/agents/product-owner.md
diff templates/core/agents/product-owner.md plugin/agents/product-owner.md
```

Expected: empty diff.

- [ ] **Step 7: Bundle and commit**

Run:

```bash
deno task bundle
git add templates/core/agents/product-owner.md plugin/agents/product-owner.md src/templates_bundle.ts
git commit -m "feat(agents): product-owner — Domain Model brief + tech-debt intake

Adds three contract elements: (1) mandatory \\\`## Domain Model\\\` block in
every brief (the developer refuses without it), (2) tech-debt intake
protocol triggered by Tech debt surfaced blocks in developer completion
reports, (3) soft fifth classification axis — bounded context — persisted
as a domain:<context> label and mandatory in the brief.

Plugin/agents mirror kept byte-identical.

Refs: docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: pre-commit hook passes.

---

## Task 3: Add baseline blocks to `constitution-template.md`

**Files:**

- Modify: `templates/core/specflow/templates/constitution-template.md` (insert 4 baseline sections
  before the existing placeholders)

The current template is a generic placeholder. We prepend Specflow's opinionated baseline so every
new project starts with TDD/DDD/SOLID/Boy-Scout already wired and a tunable layers/back/front
section. The user can amend, soften, or remove — that's still the point of a template.

- [ ] **Step 1: Apply the prepend**

Use the `Edit` tool on `templates/core/specflow/templates/constitution-template.md`. Replace this
opening:

```
# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles
```

with:

```
# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Engineering methodology (Specflow baseline)

> Specflow ships these as opinionated defaults. Amend, soften, or remove
> per principle — but a project that overrides them MUST document why.

### Test-Driven Development (NON-NEGOTIABLE)

Red → Green → Refactor on every implementation. No business logic ships
untested. If no test infra exists, the developer bootstraps it as part
of the task (Vitest for TS/JS, Pytest for Python, JUnit for Java,
`go test` for Go, `cargo test` for Rust, PHPUnit for PHP, etc.) and
notes it in the completion report.

### Domain-Driven Design (NON-NEGOTIABLE)

- Every business concept lives in its own bounded-context folder.
- Domain layer is pure: no I/O, no framework, no DB.
- Application layer orchestrates use cases via ports.
- Infrastructure layer holds adapters (DB, HTTP, queues, filesystem, SDKs).
- Presentation layer (CLI, web UI, controllers) talks only to use cases.
- Cross-bounded-context leakage is forbidden — split or use an
  anti-corruption layer.

### SOLID / DRY / KISS / YAGNI

- Single Responsibility, Open/Closed, Liskov, Interface Segregation,
  Dependency Inversion.
- DRY only when duplication is *semantic*, not accidental similarity.
- KISS: ship the smallest correct design.
- YAGNI: build what the task requires, nothing more.

### Boy Scout Rule (with escalation)

- Always leave touched files cleaner than you found them.
- In-scope small cleanups (≤ 1 file, ~15 lines diff, no API change):
  do them.
- Out-of-scope larger cleanups: log under `Tech debt surfaced` in the
  completion report — the Product Owner opens a tech-debt ticket.

## Architecture layers

> Default is hexagonal / DDD. Customize for your project's idiom.

- `domain/` — pure business types, entities, value objects, domain services
- `application/` — use cases, ports (interfaces), orchestration
- `infrastructure/` — adapters (DB, HTTP clients, queues, filesystem, SDKs)
- `presentation/` — CLI commands, web routes, API controllers, UI shells

Each bounded context gets its own subtree: `domain/<context>/`,
`application/<context>/`, `infrastructure/<context>/`.

## Back-end patterns

> Tune to your stack. Remove what doesn't apply.

- **Repository pattern** for data access — one repository port per
  aggregate root in `application/`, with the adapter in
  `infrastructure/`. Domain never imports a DB driver.
- **Service objects / use cases** — one class per use case in
  `application/`. Verb-named (`PlaceOrder`, `RefundPayment`).
- **Dependency injection through constructors** — no service locators,
  no module-level globals, no hidden singletons.
- **Controllers stay thin** — translate transport ↔ use case. No
  business logic in controllers.
- **Errors are domain types** — return typed results or throw domain
  errors; never let an HTTP/SQL error reach the domain layer.
- **Pure domain** — no logging, no metrics, no clocks inside `domain/`;
  pass them as ports from `application/`.

## Front-end patterns

> Defaults assume a component-based UI framework (React, Vue, Svelte,
> Solid…). Tune accordingly.

- **Separation of view and logic** — components render markup;
  business logic lives in hooks / composables / services / view-models.
- **No business rules in templates** — derive in hooks/composables, then
  render the result. Templates only branch on view state.
- **Smart vs dumb components** — presentational components stay pure
  and prop-driven; container components / hooks hold state and effects.
- **Single source of truth for cross-cutting state** — typed store
  (Redux, Pinia, Zustand…) or context, not deep prop-drilling.
- **API access through a typed client** — never call `fetch` directly
  from a component; route it through a service / repository layer.
- **Accessibility is non-optional** — semantic HTML, keyboard paths,
  visible focus, ARIA only when semantic HTML doesn't suffice.

## Core Principles
```

(Everything below `## Core Principles` — the existing placeholders — is preserved as-is.)

- [ ] **Step 2: Format**

Run:

```bash
deno fmt templates/core/specflow/templates/constitution-template.md
```

Expected: `Checked 1 file`.

- [ ] **Step 3: Bundle and commit**

Run:

```bash
deno task bundle
git add templates/core/specflow/templates/constitution-template.md src/templates_bundle.ts
git commit -m "feat(templates): constitution baseline — methodology + layers + patterns

Pre-populates the constitution template with four opinionated baseline
blocks: Engineering methodology (TDD/DDD/SOLID/Boy-Scout-escalation),
Architecture layers (hexagonal default), Back-end patterns (Repository,
DI, thin controllers, pure domain), Front-end patterns (view/logic
separation, smart vs dumb, typed API client, a11y).

User-tunable per project. New projects via specflow init inherit the
baseline; existing projects keep their current constitution (constitution
is user-owned, not re-written by specflow upgrade).

Refs: docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: pre-commit passes.

---

## Task 4: Add the Domain Model section to `spec-template.md`

**Files:**

- Modify: `templates/core/specflow/templates/spec-template.md` (insert one section between
  Requirements and Success Criteria, shrink Key Entities to a pointer)

- [ ] **Step 1: Insert the Domain Model section**

Use the `Edit` tool. Replace this block (currently lines 98–103 of the template):

```
### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*
```

with:

```
### Key Entities *(see Domain Model section below for full structure)*

- **[Entity 1]**: [What it represents, business-level attributes only]
- **[Entity 2]**: [What it represents, relationships]

## Domain Model *(mandatory)*

<!--
  ACTION REQUIRED: Populated by the Product Owner during /specflow clarify.
  The developer refuses to proceed without this section.
  Format mirrors the PO's /backlog brief output — same shape everywhere.
-->

**Bounded context:** [name of the business context, e.g. Checkout, Authentication]

**Vocabulary (Ubiquitous language):**

- **[Term]** — [one-line definition in the project's words]
- **[Term]** — [one-line definition]

**Entities (have identity):**

- **[Name]** [aggregate root?] — [responsibility, key relationships]

**Value objects (no identity, immutable):**

- **[Name](field1, field2)** — [invariant rule it enforces]

**Invariants (rules the domain must never break):**

- [Rule] — [why it exists]

**Out of scope (other bounded contexts touched but not owned here):**

- **[Other context]** — [how this feature interacts with it]

## Success Criteria *(mandatory)*
```

- [ ] **Step 2: Format**

Run:

```bash
deno fmt templates/core/specflow/templates/spec-template.md
```

Expected: `Checked 1 file`.

- [ ] **Step 3: Bundle and commit**

Run:

```bash
deno task bundle
git add templates/core/specflow/templates/spec-template.md src/templates_bundle.ts
git commit -m "feat(templates): spec.md gains a mandatory Domain Model section

Inserts a top-level ## Domain Model section between Requirements and
Success Criteria, with the same schema as the PO's /backlog brief output
(Bounded context, Vocabulary, Entities, Value Objects, Invariants, Out of
scope). The developer reads the same shape whether it comes from spec.md
or from a backlog brief. Key Entities sub-section retained as a short
pointer for backward visibility.

Refs: docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: pre-commit passes.

---

## Task 5: Enforce the Domain Model gate in the phase skills

**Files:**

- Modify: `templates/core/skills/specflow/phases/specify.md` (line ~83: replace step 5.7)
- Modify: `templates/core/skills/specflow/phases/clarify.md` (line ~42 area + step 6 validation:
  promote Domain Model to exit gate)
- Modify: `templates/core/skills/specflow/phases/implement.md` (line ~82 area: add explicit Domain
  Model read with BLOCKED rule)

Three small, line-targeted edits.

- [ ] **Step 1: `specify.md` — populate the Domain Model in step 5.7**

Use the `Edit` tool on `templates/core/skills/specflow/phases/specify.md`. Replace:

```
7. Identify Key Entities (if data involved)
8. Return: SUCCESS (spec ready for planning)
```

with:

```
7. **Populate the `## Domain Model` block (mandatory)** — Bounded context, Vocabulary (Ubiquitous language), Entities (with aggregate-root marker), Value Objects, Invariants, Out of scope. Use `[NEEDS CLARIFICATION: <question>]` markers for fields the input does not let you fill — `/specflow clarify` resolves them. The developer refuses to proceed if this block is absent or contains unresolved placeholders.
8. Return: SUCCESS (spec ready for planning)
```

- [ ] **Step 2: `clarify.md` — promote Domain Model to exit gate in step 6**

Use the `Edit` tool on `templates/core/skills/specflow/phases/clarify.md`. Replace:

```
6. Validation (performed after EACH write plus final pass):
   - Clarifications session contains exactly one bullet per accepted answer (no duplicates).
   - Total asked (accepted) questions ≤ 5.
   - Updated sections contain no lingering vague placeholders the new answer was meant to resolve.
   - No contradictory earlier statement remains.
   - Markdown structure valid; only allowed new headings: `## Clarifications`, `### Session YYYY-MM-DD`.
   - Terminology consistency: same canonical term used across all updated sections.
```

with:

```
6. Validation (performed after EACH write plus final pass):
   - Clarifications session contains exactly one bullet per accepted answer (no duplicates).
   - Total asked (accepted) questions ≤ 5.
   - Updated sections contain no lingering vague placeholders the new answer was meant to resolve.
   - No contradictory earlier statement remains.
   - Markdown structure valid; only allowed new headings: `## Clarifications`, `### Session YYYY-MM-DD`.
   - Terminology consistency: same canonical term used across all updated sections.
   - **Domain Model exit gate (NON-NEGOTIABLE)**: the spec's `## Domain Model` section MUST be fully populated — Bounded context, Vocabulary, Entities, Value Objects, Invariants, and Out of scope all filled, with no `[NEEDS CLARIFICATION]` markers and no template placeholders remaining. If unfilled fields remain at the end of the clarify session, do not advance — surface them as Outstanding and recommend running `/specflow clarify` again. The downstream `/specflow implement` step will refuse to proceed without this section.
```

- [ ] **Step 3: `implement.md` — add the Domain Model read in step 3**

Use the `Edit` tool on `templates/core/skills/specflow/phases/implement.md`. Replace:

```
3. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - **IF EXISTS**: Read quickstart.md for integration scenarios
```

with:

```
3. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **REQUIRED**: Read the `## Domain Model` section in spec.md. If the section is absent, empty, or still contains `[NEEDS CLARIFICATION]` markers / template placeholders → halt and report BLOCKED with reason `awaiting:product-owner-domain-brief`. The developer agent refuses to write code without this brief (see `developer.md` doctrine rule "Domain brief required before any code"). Recommend running `/specflow clarify` to fill the section before re-attempting `/specflow implement`.
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - **IF EXISTS**: Read quickstart.md for integration scenarios
```

- [ ] **Step 4: Format**

Run:

```bash
deno fmt templates/core/skills/specflow/phases/specify.md templates/core/skills/specflow/phases/clarify.md templates/core/skills/specflow/phases/implement.md
```

Expected: `Checked 3 files`.

- [ ] **Step 5: Bundle and commit**

Run:

```bash
deno task bundle
git add templates/core/skills/specflow/phases/specify.md templates/core/skills/specflow/phases/clarify.md templates/core/skills/specflow/phases/implement.md src/templates_bundle.ts
git commit -m "feat(skills): enforce Domain Model gate in specify/clarify/implement

specify step 5.7 now populates the full Domain Model block (was: Identify
Key Entities). clarify gains an explicit exit gate — the spec cannot
advance with placeholders in Domain Model. implement step 3 adds a
required Domain Model read with BLOCKED reporting when absent, mirroring
the developer agent's doctrine rule.

Refs: docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: pre-commit passes.

---

## Task 6: Full validation + open the PR

**Files:**

- No file changes — validation and PR only.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
deno task test 2>&1 | tail -20
```

Expected: ends with the test summary, all green. The repo had 196 tests before this work; the count
must stay ≥ 196 (we add zero, modify zero). If any test fails, inspect the failure — content-only
edits should not affect test logic, but if a test asserts on bundled string content (e.g.,
"developer.md contains 'TDD when test infra exists'"), the assertion may now be stale and needs
updating to match the new wording. Update the assertion before proceeding.

- [ ] **Step 2: Sandbox render check — Claude harness**

Run:

```bash
.claude/skills/test-sandbox/scripts/setup-vite-brownfield.sh sandbox/doctrine-claude
cd sandbox/doctrine-claude
deno run --allow-all ../../src/main.ts init --here --ai claude --force
grep -c "Test-Driven Development (NON-NEGOTIABLE)" .claude/agents/developer.md
grep -c "Bootstrap" .claude/agents/developer.md
grep -c "Tech debt surfaced" .claude/agents/developer.md
grep -c "Domain Model" .specflow/templates/spec-template.md
grep -c "Engineering methodology" .specflow/templates/constitution-template.md
cd ../..
```

Expected: every `grep -c` returns ≥ 1 (each phrase must be present in the rendered file).

- [ ] **Step 3: Sandbox render check — Cursor harness**

Run:

```bash
.claude/skills/test-sandbox/scripts/setup-vite-brownfield.sh sandbox/doctrine-cursor
cd sandbox/doctrine-cursor
deno run --allow-all ../../src/main.ts init --here --ai cursor --force
find .cursor -name "*developer*"
grep -c "Test-Driven Development" .cursor/skills/specflow-agent-developer/SKILL.md
cd ../..
```

Expected: file exists under `.cursor/skills/specflow-agent-developer/` and contains the new
doctrine.

- [ ] **Step 4: Sandbox render check — Codex harness**

Run:

```bash
.claude/skills/test-sandbox/scripts/setup-vite-brownfield.sh sandbox/doctrine-codex
cd sandbox/doctrine-codex
deno run --allow-all ../../src/main.ts init --here --ai codex --force
find .codex .agents -name "*developer*"
grep -c "Test-Driven Development" .agents/skills/specflow-agent-developer/SKILL.md
cd ../..
```

Expected: developer file present in both `.codex/agents/` (TOML) and
`.agents/skills/specflow-agent-developer/SKILL.md`, and the SKILL.md contains the new doctrine.

- [ ] **Step 5: Clean up sandboxes**

Run:

```bash
rm -rf sandbox/doctrine-claude sandbox/doctrine-cursor sandbox/doctrine-codex
```

Expected: no residue (the `sandbox/` directory is gitignored, but tidy anyway).

- [ ] **Step 6: Push the branch**

Run:

```bash
git push -u origin feat/developer-agent-doctrine
```

Expected: branch pushed, ready for PR.

- [ ] **Step 7: Open the PR**

Run:

```bash
gh pr create --base main --head feat/developer-agent-doctrine \
  --title "feat(agents): developer doctrine — TDD always, DDD by default, Boy-Scout escalation" \
  --body "$(cat <<'EOF'
## Summary

Raises the engineering quality bar of every project Specflow scaffolds by
giving the bundled `developer` agent a stronger always-on doctrine and the
matching `product-owner` contract.

**New developer doctrine:**

- TDD always (bootstraps test infra when missing — Vitest/Pytest/JUnit/etc.)
- DDD by default — pure domain, ports/adapters, no cross-context bleed
- Domain brief required before any code (BLOCKED if absent)
- Boy Scout Rule with escalation — small cleanups in-scope, larger ones
  flagged in a `Tech debt surfaced` block of the completion report
- SOLID / DRY / KISS / YAGNI made explicit
- Existing rules preserved (smallest correct change, no silent catches,
  in-code documentation)

**New PO contract:**

- Mandatory `## Domain Model` block in every brief
- Tech-debt intake protocol — parses developer reports, opens classified
  tickets one per item
- Soft fifth classification axis — bounded context as a `domain:*` label

**Constitution template:**

- Pre-populated Engineering methodology, Architecture layers, Back-end
  patterns, Front-end patterns blocks — user-tunable

**Spec template:**

- New mandatory `## Domain Model` section between Requirements and Success
  Criteria — same schema as the PO brief output

**Phase skills:**

- `specify` step 5.7 populates the Domain Model block
- `clarify` cannot exit while the Domain Model is incomplete
- `implement` refuses to proceed without a Domain Model

## Cross-harness

Automatic via the existing template bundle + per-harness adapters. Sandbox-
validated on Claude, Cursor, and Codex renderings.

## Backward compatibility

- New projects: inherit the new defaults via `specflow init`.
- Existing projects: receive the new agents and spec template via
  `specflow upgrade`. The constitution is user-owned and NOT re-written —
  users can manually rebase against the new baseline if they want it.
- In-flight specs without a Domain Model section: `/specflow implement`
  surfaces a BLOCKED report on first run; user fixes the spec; subsequent
  runs work normally.

## Refs

- Design: `docs/superpowers/specs/2026-05-15-developer-agent-doctrine-design.md`
- Plan: `docs/superpowers/plans/2026-05-15-developer-agent-doctrine.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened. Capture the PR number for follow-up review.

- [ ] **Step 8: Final verification**

Run:

```bash
gh pr view --json number,state,url
```

Expected: PR open, URL printed.

---

## Self-review

**Spec coverage** — each spec section maps to a task:

- §3.1 Developer agent → Task 1 ✓
- §3.2 PO agent (Domain Model brief + intake + bounded context) → Task 2 ✓
- §3.3 Constitution baselines (methodology + layers + back + front) → Task 3 ✓
- §3.4 Spec template Domain Model → Task 4 ✓
- §3.5 specify step 5.7 → Task 5 step 1 ✓
- §3.6 clarify exit gate → Task 5 step 2 ✓
- §3.7 implement step 3 → Task 5 step 3 ✓
- §4 Cross-harness propagation → Task 6 sandbox checks (Claude/Cursor/Codex) ✓
- §5 Backward compatibility → Task 6 PR body callouts ✓
- §7 Validation plan → Task 6 ✓
- §9 Files touched (9 total) → all covered in Tasks 1–5 ✓

**Placeholder scan** — no TBD/TODO/"similar to" references. Every Edit step shows the exact
`old_string` and `new_string`. Every commit message is fully drafted.

**Type consistency** — Markdown content only; no types. Cross-references between tasks: the Domain
Model schema appears in Task 2 step 3 (PO `/backlog brief` description), Task 4 step 1
(spec-template section), and Task 5 step 1 (specify populate instruction). The schema fields are
byte-identical across all three: Bounded context, Vocabulary, Entities, Value objects, Invariants,
Out of scope. The `Tech debt surfaced` block format appears in Task 1 (developer report) and Task 2
step 4 (PO parses it) — format identical: `<one-liner> @ <path>:<line> — <reason>`.
