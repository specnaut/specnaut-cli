---
name: typography
description: Typography knowledge base for Miximodel — a fashion + photography editorial product. Heuristics for type choice, pairing, sizing, tracking, leading, and accessibility; curated catalog of libre-de-droit (OFL / Apache 2.0 / Ubuntu FL) typefaces; web-delivery performance rules; and a concrete stack recommendation for Miximodel's burgundy + gold editorial positioning. Trigger on "typography", "typo", "font", "typeface", "font pairing", "display face", "serif", "sans-serif", "Google Fonts", "Fontsource", "variable font", "font license", "libre font", "free font", "WOFF2", "@font-face", "@theme --font-", or any request to refresh / pick typography on landing, blog, editorial surfaces, or product UI.
---

# Typography — Miximodel Knowledge Base

Type-choice guide, libre-font catalog, and performance rules for
Miximodel. Miximodel's domain is **fashion + photography editorial**,
so "default system font" is never the right answer.

## Strategic Context

Miximodel's design system is moving toward a burgundy + gold + cream
editorial aesthetic (tasks `033`, `054`, `070`, `075`, `080`). The
type system has not caught up: as of task `081` creation, the app
ships a single `--font-sans` token pointing at `Inter Variable` — a
technically excellent but editorially anonymous choice. This skill
exists to give the typography specialist (and any agent that consults
it) a researched foundation for closing that gap.

## Core Principles (always in context)

1. **Two families, never three.** One display face (headlines, hero,
   pull quotes) + one text face (running copy, UI, captions). A
   monospace for code / technical numbers doesn't count.
2. **Contrast > subtlety.** A serif + sans-serif pair reads
   immediately. Two serifs from different eras can work but require
   taste. Two fonts that are "almost the same" clash.
3. **Libre-de-droit or nothing.** SIL Open Font License (preferred),
   Apache 2.0, or Ubuntu Font License. Paid foundry licenses are
   explicitly out of scope even as aspirational references.
4. **Variable fonts when available.** One file, many weights, smaller
   total payload for most multi-weight use-cases.
5. **WOFF2 only.** No TTF / WOFF / EOT in 2026.
6. **Self-host via `@fontsource-variable/*` packages** — avoids the
   third-party-CDN coupling of `fonts.googleapis.com`.
7. **Budget: < 50 KB per static weight subsetted, < 150 KB for a
   variable font with Latin + Latin-Extended.**
8. **Body-text sanity (Butterick):** 16–20 px, 45–90 character
   measure, 1.4–1.6× leading. Body weight ≥ 400.
9. **Display ≠ body.** A display face designed for 48 px+ usage
   breaks below 24 px. Don't force one into body duty.
10. **Fashion ≠ unreadable.** Beautiful + legible is the bar. A
    stunning hairline that fails WCAG AA at body size is a hero face,
    not a text face.

## When to Consult This Skill

- Picking a typeface for any surface (landing, blog, editorial, UI,
  email, export PDF).
- Refreshing an existing surface's typography.
- Debating "does this font feel fashion enough".
- Vetting a font's license for commercial use.
- Writing Tailwind v4 `@theme` font tokens in `inertia/css/app.css`.
- Adding or replacing an `@fontsource*` package in `package.json`.
- Reviewing accessibility of an existing type system (min size,
  contrast, weight).

## Load-on-Demand References

Read only what the current task requires. Each file is self-contained.

| When the task involves...                                    | Read                                  |
| ------------------------------------------------------------ | ------------------------------------- |
| Picking / pairing typefaces, sizing, measure, leading        | `references/principles.md`            |
| Concrete font recommendations, license, equivalents to paid  | `references/libre-fonts-catalog.md`   |
| Miximodel-specific stack proposal (landing / blog / UI)      | `references/miximodel-recommendations.md` |
| Web delivery, variable fonts, subsetting, `font-display`     | `references/performance.md`           |
| FAQ, libre equivalents to commercial foundry faces, glossary | `references/faq.md`                   |

## Quick Links — Authoritative Sources

When the references don't cover a question, consult these sources
first (listed in order of editorial-typography authority for this
project). Use `WebFetch` / `WebSearch` and **update the relevant
reference file** with the new knowledge.

- Butterick's Practical Typography — <https://practicaltypography.com>
  (body-text rules, point size, measure, leading).
- Typewolf — <https://www.typewolf.com>
  (fashion + editorial trend watch, libre-alternative lookbooks).
- Google Fonts — <https://fonts.google.com>
  (catalog of SIL OFL / Apache 2.0 families, variable support badges).
- Fontsource — <https://fontsource.org>
  (self-hostable npm packages for the Google Fonts catalog + more).
- Velvetyne — <https://velvetyne.fr>
  (French libre foundry, distinctive display faces for editorial).
- Uncut.wtf — <https://uncut.wtf>
  (curated libre catalog beyond Google Fonts).
- web.dev font best practices — <https://web.dev/articles/font-best-practices>.
- Smashing Magazine typography archive — <https://www.smashingmagazine.com/category/typography>.

## The One-Pager Answer (fastest routing)

If the user just wants "what should Miximodel's type look like?" load
`references/miximodel-recommendations.md`. That file is the synthesis.

If the user wants to understand *why*, load `references/principles.md`
first.

If the user is asking about a specific library / format / delivery
detail, load `references/performance.md`.

If the user names a commercial foundry face and asks for a substitute,
load `references/faq.md` (section "Libre Equivalents").

## Anti-Goals

- Recommending any paid foundry (Commercial Type, Klim, Grilli, Pangram
  Pangram non-free cuts, Dinamo, ABC Dinamo, etc.) — even to say
  "ideally we'd use X". Counter-offer a libre equivalent instead.
- Proposing 4+ families on a surface.
- Shipping font assets without a subsetting strategy.
- Using `font-display: block` (causes FOIT — invisible text).
- Body copy in weight < 400 or size < 16 px.
- Silent hotlinking of `fonts.googleapis.com` in production pages.
