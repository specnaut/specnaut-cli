# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Engineering methodology (Specnaut baseline)

> Specnaut ships these as opinionated defaults. Amend, soften, or remove
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

## Size limits

> This table is the only source of size thresholds for every Specnaut phase,
> agent and script. A unit it does not list falls back to the default in
> `.specnaut/memory/size-limits.md`. Edit the numbers; keep the shape.

| Unit | Target | Ceiling |
| :--- | ---: | ---: |
| file | 300 | 500 |
| function | 30 | 50 |

Exempt: `*.lock`

1. **A unit over its ceiling fails** — unless the change shrinks it.
2. **A unit over its target may not grow** — no larger than when the change
   began.
3. **Extract before you add** — when a change must add to a file over its
   target, the extraction lands first and moves out at least as many lines as
   the change adds to that file.

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
- **Mobile-first is the default** — any UI, web or native, follows the
  `mobile-first-contract` skill. Read it; never restate it here. It is a
  default, not a mandate: to declare an exception, replace the body of
  `### Target surface` below with the sentence the contract names. Leave it as
  it is and mobile-first is assumed.

### Target surface

*This project has NOT declared an exception, so mobile-first is assumed.*

If it genuinely targets a narrower surface, the `mobile-first-contract` skill
names the exact sentence to write here. Read it there. The form is deliberately
not reproduced in this file: a copy of it sitting under this heading is
indistinguishable from a project that made the declaration, so a template
carrying one would ship the feature switched off to everyone who copies the
template without editing it.

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: Every feature starts as a standalone library; Libraries must be self-contained, independently testable, documented; Clear purpose required - no organizational-only libraries -->

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: Every library exposes functionality via CLI; Text in/out protocol: stdin/args → stdout, errors → stderr; Support JSON + human-readable formats -->

### [PRINCIPLE_3_NAME]
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: TDD mandatory: Tests written → User approved → Tests fail → Then implement; Red-Green-Refactor cycle strictly enforced -->

### [PRINCIPLE_4_NAME]
<!-- Example: IV. Integration Testing -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Focus areas requiring integration tests: New library contract tests, Contract changes, Inter-service communication, Shared schemas -->

### [PRINCIPLE_5_NAME]
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
[PRINCIPLE_5_DESCRIPTION]
<!-- Example: Text I/O ensures debuggability; Structured logging required; Or: MAJOR.MINOR.BUILD format; Or: Start simple, YAGNI principles -->

## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
