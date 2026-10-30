# DESIGN.md — <Project> design system

> **Source of truth.** All UI work consults this file. Tokens here are
> non-negotiable defaults; deviations need an explicit reason.

## Brand identity

- **Mood:** <one phrase, e.g. "calm modern, dense, ergonomic">
- **One-liner:** <product elevator pitch, 12-18 words>
- **Audience:** <who uses this and in what context>

## Typography

| Role    | Family                      | Weight | Size (narrow → wide)   | Line height |
| ------- | --------------------------- | ------ | ---------------------- | ----------- |
| Display | <e.g. Inter, ui-sans-serif> | 700    | `--fs-display` 32 → 48 | 1.1         |
| H1      | Inter                       | 700    | `--fs-h1` 26 → 32      | 1.2         |
| H2      | Inter                       | 600    | `--fs-h2` 21 → 24      | 1.3         |
| H3      | Inter                       | 600    | `--fs-h3` 17 → 18      | 1.4         |
| Body    | Inter                       | 400    | `--fs-body` 16         | 1.6         |
| Caption | Inter                       | 400    | `--fs-caption` 13      | 1.5         |
| Code    | JetBrains Mono              | 400    | `--fs-code` 14         | 1.5         |

The Size column is a **token and a range**, not a number. A single fixed value
at every width is what the Responsive section calls non-conforming — and a
skeleton that ships one teaches the opposite of the contract. Roles that
genuinely do not scale (Body, Caption, Code) say so by carrying one value; the
ones that do carry both ends and are interpolated or stepped at `--bp-*`.

**Pairings rule of thumb:** one sans (Inter / IBM Plex Sans) for UI,
one mono (JetBrains Mono / IBM Plex Mono) for code blocks. Add a
serif (Source Serif Pro / Fraunces) only for editorial / long-prose
products.

## Color palette

| Token              | Light       | Dark        | Use                 |
| ------------------ | ----------- | ----------- | ------------------- |
| `--brand-primary`  | `#4F46E5`   | `#818CF8`   | Primary actions     |
| `--brand-accent`   | `#EC4899`   | `#F472B6`   | Highlights, focus   |
| `--neutral-0`      | `#FFFFFF`   | `#0B0B0E`   | App background      |
| `--neutral-50`     | `#F8FAFC`   | `#111114`   | Surface             |
| `--neutral-100`    | `#F1F5F9`   | `#1A1A1F`   | Subtle surface      |
| `--neutral-300`    | `#CBD5E1`   | `#3F3F46`   | Borders             |
| `--neutral-700`    | `#334155`   | `#A1A1AA`   | Secondary text      |
| `--neutral-900`    | `#0F172A`   | `#FAFAFA`   | Primary text        |
| `--success`        | `#10B981`   | `#34D399`   | Success / valid     |
| `--warning`        | `#F59E0B`   | `#FBBF24`   | Warning / caution   |
| `--danger`         | `#EF4444`   | `#F87171`   | Error / destructive |
| `--info`           | `#3B82F6`   | `#60A5FA`   | Informational       |

**Contrast rule:** body text on its surface MUST hit WCAG AA (4.5:1).
If a colour fails, escalate it to `--neutral-900` / `--neutral-0`
rather than tinting toward middle grey.

## Spacing scale (4-point base)

`--space-0` 0 · `--space-1` 4 · `--space-2` 8 · `--space-3` 12 ·
`--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 ·
`--space-10` 40 · `--space-12` 48 · `--space-16` 64 · `--space-24` 96

The ladder is one set of steps; what changes across widths is **which step a
given role uses**, declared alongside the breakpoints. A layout that reaches
for the same `--space-*` at every width is the fixed scale the Responsive
section rules out.

No raw pixel values in components. Off-grid sizes are a code-review
block.

## Radius + shadow

| Token           | Value             | Use                            |
| --------------- | ----------------- | ------------------------------ |
| `--radius-none` | `0`               | Tables, full-bleed             |
| `--radius-sm`   | `4px`             | Inputs, badges                 |
| `--radius-md`   | `8px`             | Buttons, cards (default)       |
| `--radius-lg`   | `12px`            | Modals, large cards            |
| `--radius-full` | `9999px`          | Pills, avatars                 |
| `--shadow-sm`   | `0 1px 2px rgb(0 0 0 / 0.05)` | Resting elevation |
| `--shadow-md`   | `0 4px 8px rgb(0 0 0 / 0.08)` | Hover, dropdowns |
| `--shadow-lg`   | `0 10px 24px rgb(0 0 0 / 0.12)` | Modals, popovers |

## Responsive and adaptive

**Mobile-first is assumed** — you never ask whether the user wants it. Ask
about the exception only when their brief signals a genuinely narrow target
(an operator console, an internal dashboard, a stated desktop-only audience).
If they confirm one, **tell them where it goes and stop** — the
`mobile-first-contract` skill names the file and the exact sentence. `/design`
writes `DESIGN.md` and nothing else, so recording it is theirs to do.

`DESIGN.md` is where the **values** live. Declare, as tokens:

- `--bp-*` — the breakpoint ladder, smallest first. Name them for intent, not
  for devices; a device list dates and a ladder does not.
- `--touch-min` — the minimum hit area for anything interactive. One number,
  used everywhere; a primitive that states its own is a second decider.
- Type and spacing scales that carry a narrow value and a wide one, or a rule
  for interpolating between them. What "adapts" means is the contract's to
  define, not this file's.

Author the narrow layout first and treat wider ones as enhancement. What each
of those obligations means is the `mobile-first-contract` skill's to say — read
it; never restate it here.

## Component primitives

For each primitive, declare states + a one-line behaviour rule. Don't
ship implementation code here — the developer translates the spec into code.

- **Button** — variants: `primary`, `secondary`, `ghost`, `danger`.
  States: rest, hover, active, focus-visible (2px ring `--brand-accent`),
  disabled (opacity 0.5, no events).
- **Input** — border `--neutral-300`, focus border `--brand-primary`,
  error border `--danger`. Min height `--touch-min` (see Responsive).
- **Card** — surface `--neutral-50`, border `--neutral-100`,
  radius `--radius-md`, shadow `--shadow-sm`.
- **Modal** — overlay `rgb(0 0 0 / 0.4)`, surface `--neutral-0`,
  radius `--radius-lg`, shadow `--shadow-lg`, focus-trap on open.

## Motion

- Default duration: `150ms` for micro (hover, focus), `250ms` for
  transitions (panels open).
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out-quart). Linear
  only for progress / loaders.

## Decision log

Append-only. Every change to the tokens above lands a one-liner with
the date and the rationale.

- YYYY-MM-DD — initial system drafted from <user's brief>.
