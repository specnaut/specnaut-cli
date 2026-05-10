# DESIGN.md — Specflow design system

> **Source of truth.** All UI work consults this file. Tokens here are non-negotiable defaults;
> deviations need an explicit reason.

## Brand identity

- **Mood:** calm playful, airy, pixel-art soft — sprites carry the colour interest, chrome stays
  quiet
- **One-liner:** Install nine named AI agents across eight coding harnesses with a single curl
  command.
- **Audience:** Developers already using an AI coding harness (Claude Code, Cursor, Copilot, etc.)
  who want a structured multi-agent workflow in their repo — arriving via GitHub or Hacker News.

## Typography

| Role    | Family                    | Weight | Size | Line height |
| ------- | ------------------------- | ------ | ---- | ----------- |
| Display | DM Sans, ui-sans-serif    | 700    | 48px | 1.1         |
| H1      | DM Sans, ui-sans-serif    | 700    | 32px | 1.2         |
| H2      | DM Sans, ui-sans-serif    | 600    | 24px | 1.3         |
| H3      | DM Sans, ui-sans-serif    | 600    | 18px | 1.4         |
| Body    | DM Sans, ui-sans-serif    | 400    | 16px | 1.6         |
| Caption | DM Sans, ui-sans-serif    | 400    | 13px | 1.5         |
| Code    | JetBrains Mono, monospace | 400    | 14px | 1.5         |

**Pairing rule:** DM Sans only for all UI text (its rounded geometry pairs well with chunky pixel
sprites without competing). JetBrains Mono for the install snippet and all inline code. No serif —
too editorial for an agentic-tooling landing page.

## Color palette

| Token                   | Light     | Dark      | Use                       |
| ----------------------- | --------- | --------- | ------------------------- |
| `--color-brand-primary` | `#5B6AF0` | `#818CF8` | Primary actions, focus    |
| `--color-brand-accent`  | `#F59E6C` | `#FDBA74` | CTAs (Install, CTA hover) |
| `--color-neutral-0`     | `#FFFFFF` | `#0C0C10` | App background            |
| `--color-neutral-50`    | `#F7F8FC` | `#13131A` | Page surface              |
| `--color-neutral-100`   | `#ECEEF6` | `#1C1C27` | Subtle surface, card bg   |
| `--color-neutral-300`   | `#C8CCDF` | `#3A3A52` | Borders, dividers         |
| `--color-neutral-700`   | `#4A4E6A` | `#9B9FC0` | Secondary text            |
| `--color-neutral-900`   | `#16182E` | `#F0F1FA` | Primary text              |
| `--color-success`       | `#10B981` | `#34D399` | Success / valid           |
| `--color-warning`       | `#F59E0B` | `#FBBF24` | Warning / caution         |
| `--color-danger`        | `#EF4444` | `#F87171` | Error / destructive       |
| `--color-info`          | `#3B82F6` | `#60A5FA` | Informational             |

**Rationale for this palette:** The indigo-leaning `--color-brand-primary` sits in the same family
as the AI-tooling conventions (Copilot, Cursor) without copying them exactly. The warm peach
`--color-brand-accent` gives CTAs approachability and warmth without clashing with pixel-art sprites
— the sprites themselves supply additional colour through their own flat pixel palette; the chrome
must not fight them.

**Contrast rule:** body text on its surface MUST hit WCAG AA (4.5:1). If a colour fails, escalate
toward `--color-neutral-900` / `--color-neutral-0` rather than tinting to middle grey.

**Theme switching:** all tokens are declared in `:root` for light; a
`@media (prefers-color-scheme: dark)` block overrides the dark column values on the same property
names. No JS required.

## Spacing scale (4-point base)

`--space-0` 0 · `--space-1` 4px · `--space-2` 8px · `--space-3` 12px · `--space-4` 16px ·
`--space-5` 20px · `--space-6` 24px · `--space-8` 32px · `--space-10` 40px · `--space-12` 48px ·
`--space-16` 64px · `--space-24` 96px

No raw pixel values in components. Off-grid sizes are a code-review block. The landing intentionally
uses large gaps (`--space-16`, `--space-24`) to keep the layout airy around floating sprites.

## Radius + shadow

| Token           | Value                           | Use                          |
| --------------- | ------------------------------- | ---------------------------- |
| `--radius-none` | `0`                             | Pixel-art containers, tables |
| `--radius-sm`   | `4px`                           | Badges, code inline          |
| `--radius-md`   | `8px`                           | Buttons, inputs (default)    |
| `--radius-lg`   | `12px`                          | Cards                        |
| `--radius-full` | `9999px`                        | Pills                        |
| `--shadow-sm`   | `0 1px 2px rgb(0 0 0 / 0.05)`   | Resting elevation            |
| `--shadow-md`   | `0 4px 8px rgb(0 0 0 / 0.08)`   | Hover, dropdowns             |
| `--shadow-lg`   | `0 10px 24px rgb(0 0 0 / 0.12)` | Modals, popovers             |

**Note on pixel-art containers:** sprite images themselves should use `--radius-none` so their
pixel-perfect edges are not rounded. The card that _hosts_ a sprite may use `--radius-lg`.

## Component primitives

### Button

Variants: `primary`, `secondary`, `ghost`.

- **primary** — background `--color-brand-accent`, text `--color-neutral-0`, `--radius-md`. This is
  the Install CTA. On hover: lighten accent by ~8% (use `filter: brightness(1.08)`).
- **secondary** — background `--color-neutral-100`, text `--color-neutral-900`, border
  `--color-neutral-300`, `--radius-md`. GitHub and Docs CTAs.
- **ghost** — no background, no border, text `--color-brand-primary`, underline on hover.

States (all variants): rest, hover (`--shadow-sm` lifts to `--shadow-md`), active (scale 0.97),
focus-visible (2px solid ring `--color-brand-primary`, 2px offset), disabled (opacity 0.45,
pointer-events none).

Min height 40px. Padding `--space-3` vertical, `--space-5` horizontal.

**Behaviour rule:** buttons never change layout dimensions between states — only colour, shadow, and
scale shift; avoid layout reflow on hover.

### Card

Used in the "what you get" 3-up grid.

- Surface `--color-neutral-100`, border `1px solid --color-neutral-300`, `--radius-lg`,
  `--shadow-sm`.
- On hover: `--shadow-md`, border colour shifts to `--color-brand-primary` at 60% opacity.
- Padding `--space-6` all sides. If a sprite sits atop the card, let it overflow the top edge by
  half its height (`margin-top: calc(-1 * spriteHeight / 2)`).

**Behaviour rule:** card hover is decorative only — no content changes, no transform — so
`prefers-reduced-motion` requires no override here.

### CodeBlock

Used for the install snippet (`curl … | sh`).

- Background `--color-neutral-900` in both light and dark (the code block is always dark, echoing
  terminal convention). Text `--color-neutral-0`. Font `Code` scale (JetBrains Mono 14px, lh 1.5).
  `--radius-md`. Padding `--space-4` vertical, `--space-6` horizontal.
- A "Copy" button sits in the top-right corner: ghost variant, icon-only (`⎘`), 32×32px,
  `--radius-sm`. On copy success: swap icon to a checkmark for 1.5 s, then revert. No toast.
- Horizontal overflow: `overflow-x: auto` with `-webkit-overflow-scrolling: touch`.
- No syntax highlighting required for a single shell command; keep it as plain monospace text.

**Behaviour rule:** the code block width is bounded by its container; it never causes horizontal
page scroll.

## Motion

- Default duration: `150ms` for micro-interactions (hover, focus ring). `250ms` for panel
  transitions.
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out-quart). Linear only for progress/loaders.

### Floating-sprite bob

Pixel-art sprites on the landing page use a gentle vertical bob to convey life without overwhelming
the calm mood.

```css
@keyframes sprite-bob {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-8px);
  }
}

.sprite {
  animation: sprite-bob 3s ease-in-out infinite alternate;
}

@media (prefers-reduced-motion: reduce) {
  .sprite {
    animation: none;
  }
}
```

**Parameters:** 8px vertical travel (enough to read as floating at typical sprite sizes of 48–96 px;
tighten to 4px for sprites smaller than 32px). `alternate` fill mode means the sprite rocks gently
up and down without a jump-cut reset. Duration 3s keeps it calm — do not go below 2s or it reads as
energetic.

**Reduced-motion rule:** `animation: none` on `.sprite` — the sprite renders at its resting position
(`translateY(0)`) with no fallback transition. Do not substitute a slower animation; remove it
entirely per WCAG 2.3.3 intent.

## Decision log

Append-only. Every change to the tokens above lands a one-liner with the date and the rationale.

- 2026-05-10 — Initial system drafted from "Specflow public landing page redesign for issue #187".
  Chose DM Sans (rounded, friendly, pairs well with pixel sprites) over Inter. Chose slate-indigo
  primary + warm peach accent so sprites carry colour interest while chrome stays neutral.
  Floating-sprite bob rule added at 3 s / 8 px per brief requirement.
