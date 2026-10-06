# Project Constitution

> This file holds the invariants of your project: architecture rules, conventions, and
> non-negotiable policies. Specnaut commands and review agents read it at every step.
>
> Replace this placeholder with your own constitution. Use
> `.specnaut/templates/constitution-template.md` as a starting point.

## Principles

(none defined yet)

## Size limits

> This table is the only source of size thresholds for every Specnaut phase,
> agent and script. A unit it does not list falls back to the default in
> `.specnaut/memory/size-limits.md`. Edit the numbers; keep the shape.

| Unit | Target | Ceiling |
| :--- | ---: | ---: |
| file | 300 | 500 |
| function | 30 | 50 |

Exempt: `*.lock`

1. **A unit over its ceiling fails.**
2. **A unit over its target may not grow** — lines after ≤ lines before.
3. **Extract before you add** — when a change must touch a file over its
   target, the extraction lands first and moves out at least as many lines as
   the change adds.

## Front-end patterns

- **Mobile-first is the default** — any UI, web or native, follows the
  `mobile-first-contract` skill. Read it; never restate it here.

### Target surface

*This project has NOT declared an exception, so mobile-first is assumed.*

If it genuinely targets a narrower surface — an operator console, an internal
dashboard, a known desktop-only audience — the `mobile-first-contract` skill
names the exact heading and sentence to write here. Read it there; the literal
form is deliberately not reproduced in this file, because a copy of it sitting
in a shipped seed is indistinguishable from a project that made the
declaration.
