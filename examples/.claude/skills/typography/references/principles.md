# Typography Principles — Editorial + Fashion + Web

Heuristics for type choice, pairing, sizing, tracking, leading, and
accessibility — tuned for a fashion + photography editorial product.

---

## 1. Classification — Know What You're Picking

Every typeface you consider falls into a role. Getting the role right
matters more than "do I like this font."

| Role        | Job                                         | Typical design                                      |
| ----------- | ------------------------------------------- | --------------------------------------------------- |
| Display     | Hero, masthead, pull quotes, 48 px+         | High contrast, narrow, ornate, expressive           |
| Text serif  | Long-form editorial body (blog, articles)   | Modest contrast, generous x-height, open counters   |
| Text sans   | Product UI, forms, navigation, captions     | Neutral, humanist or geometric, 400–600 weights     |
| Mono        | Code, tabular numbers, technical metadata   | Fixed-width, slab or geometric                      |

A **display face** designed for 48 px loses legibility below 24 px —
it was never meant to carry body duty.

A **text face** designed for 16 px body copy loses presence above 48 px
— it was never meant to carry a hero.

Picking one face that "does everything" is the signal move of a
default SaaS dashboard. Miximodel is not that.

---

## 2. Pairing — The Two-Family Rule

One display face + one text face. That's the default system.

Adding a third family is an *exception* that needs justification
(e.g., a mono for code blocks on an engineering blog). In editorial
contexts you almost never need three.

### Safest pairing strategies (editorial-tuned)

1. **Serif display + sans-serif text.** The most legible hierarchy.
   A high-contrast serif gives the masthead fashion-magazine weight;
   a neutral sans carries the reading without fighting for attention.
   *Example (libre): Fraunces + Inter.*
2. **Sans-serif display + serif text.** The "modernist editorial"
   move — a bold geometric or grotesque for display, a classic serif
   for long-form reading. Slightly riskier; the display face must be
   distinctive enough to carry the masthead.
   *Example (libre): Space Grotesk + Lora.*
3. **Two serifs from different eras.** Expert move. A 19th-century
   transitional + a contemporary high-contrast serif can sing. Don't
   attempt without a clear visual reference.
   *Example (libre): Cormorant Garamond + Libre Baskerville.*

### Pairings to avoid

- **Two sans-serifs that are nearly alike** (Inter + Work Sans) —
  users cannot tell there is a hierarchy; it just looks broken.
- **Two display faces** — the page starts shouting in stereo.
- **Superfamily siblings pretending to be a pair** (Roboto + Roboto
  Slab at similar weights) — monotonous.
- **A script / handwritten face as body copy** — always wrong.

### The Contrast Test

Before committing to a pairing, ask:

- Is there a visible size / weight / contrast difference between the
  two families at the same point size? If no, kill the pairing.
- Could a reader *see* which family is display vs text without being
  told? If no, kill the pairing.

---

## 3. Body-Text Sanity (Butterick)

Non-negotiable numbers for running copy on the web:

| Property       | Range                                   |
| -------------- | --------------------------------------- |
| Point size     | 16–20 px (18 px is a safe editorial default) |
| Measure        | 45–90 characters per line (65 is ideal) |
| Leading        | 1.4–1.6× point size (1.5 safe default)  |
| Body weight    | 400 or 500 (never thinner)              |
| Paragraph gap  | One empty line OR first-line indent, not both |

On Miximodel's editorial blog, `text-base` (16 px) with
`leading-relaxed` (1.625) is already within range. Landing hero can
push to 18–20 px for long paragraphs; any display headline sits at
40–88 px.

---

## 4. Tracking (Letter-Spacing) Conventions

Tracking changes the *voice* of a word without changing the family.

| Use case                                  | Recommended tracking       |
| ----------------------------------------- | -------------------------- |
| Body text (serif or sans, 16–20 px)       | 0 (none) — the font is already tuned |
| Display headline (40 px+)                 | -0.01em to -0.02em (tighten slightly) |
| All-caps eyebrow / label / nav (10–14 px) | +0.08em to +0.15em (always open up caps) |
| Small caps / acronyms in running text     | +0.02em to +0.04em         |
| Numeric / tabular data                    | 0 — let the font handle it |

**Rule of thumb:** the smaller and / or more uppercase the text, the
*more* tracking it needs. Tight tracking on uppercase looks cramped.

Miximodel already applies this on the landing hero (task `054`) —
eyebrows and MIXIMODEL wordmark open up; body copy stays at 0.

---

## 5. Magazine-Style Conventions

These are the moves that make a page read "editorial" instead of
"product dashboard." Use sparingly and intentionally.

- **All-caps eyebrow** — 11–13 px, +0.12em tracking, above a headline.
  Signals "section / category / kicker" without another headline level.
- **Drop cap** — first letter of an editorial article at 3–5× body
  size. Only on long-form articles, never on UI.
- **Pull quote** — display-face, 24–36 px, italic or not, usually set
  off with a top / bottom rule or indent. One per article max.
- **Small caps** — for acronyms (MIXIMODEL), proper nouns in running
  text, or footer metadata. Requires a font with true small caps —
  fake "small caps" from `font-variant` look lighter than the real
  thing.
- **Oldstyle figures (OsF)** — numbers with ascenders and descenders
  (3, 5, 7, 9 go below baseline). Use in running text so numbers don't
  shout. Switch to lining figures (tabular) for tables / stats.
- **Ligatures** — `font-variant-ligatures: common-ligatures` is safe.
  Discretionary ligatures (ct, st) only on display faces and only
  when they feel like the point of the display face.

Not every editorial page needs all of these. A drop cap on a product
settings screen is wrong; a pull quote on a blog article is right.

---

## 6. Web-Type Accessibility (WCAG + Common Sense)

Non-negotiable accessibility floors:

- **Minimum body size: 16 px** (1 rem). Smaller than this forces users
  to zoom and breaks WCAG success criteria.
- **Minimum body weight: 400.** Weights below 400 (Thin, ExtraLight,
  Light) are a fashion-magazine reflex that wrecks legibility,
  especially on dark-mode surfaces.
- **Contrast AA:** body text must hit 4.5:1 against its background.
  High-contrast display serifs have thin hairlines that can fail
  contrast at small sizes — test at the size you actually render.
- **Line length cap:** 90 characters. Longer lines force readers to
  track back and lose the next line.
- **Never use text inside an image for anything important** — no
  screen reader sees it.
- **Respect `prefers-reduced-motion`** for any animated type
  (variable-font weight animations etc.).
- **Dyslexia-friendly families** (Atkinson Hyperlegible, Lexend)
  exist but Miximodel does not currently ship a toggle. Keep this in
  mind when / if an a11y preference system gets added.

---

## 7. Dark-Mode Typography

Dark mode changes the visual weight of type. Light text on dark
background *looks* bolder than the same weight on a light background
because of optical illusions.

- **Drop one weight on dark.** A 500 weight body on light mode often
  looks correct at 400 on dark. Test both.
- **Avoid Thin / ExtraLight on dark.** The halation effect
  (light-on-dark "glow") eats the hairlines.
- **Consider slightly looser letter-spacing on dark** for small text
  — +0.01em to +0.02em improves legibility on OLED.

Miximodel's current dark-mode palette (task `071` pending refinement)
uses near-black backgrounds; these rules apply.

---

## 8. Per-Surface Typography Intent

| Surface                          | Intent                                 | Primary role                |
| -------------------------------- | -------------------------------------- | --------------------------- |
| Landing (hero)                   | Editorial fashion-magazine presence    | Display face dominant       |
| Landing (body sections)          | Editorial + readable                   | Text face dominant, display for H2 |
| Blog / article (`/blog/:slug`)   | Long-form editorial reading            | Text face for body, display for title only |
| Profile / portfolio (`/p/*`)     | Image-first; type supports, doesn't compete | Text face, restrained display |
| Product UI (feed, chat, settings)| Clarity + speed; fashion voice muted   | Text sans-serif only, no display |
| Email / notifications            | Match editorial voice, but safe        | System fallback OK          |

The critical insight: **Miximodel is editorial on marketing and blog
surfaces; it is product UI inside the app.** The typography system
must support both without letting the display face bleed into
settings screens.

---

## 9. Typographic Red Flags

Signals that a type system has drifted:

- Four or more font families loaded on one page.
- Body text thinner than 400 weight.
- Body text smaller than 16 px.
- A display face used for a button label.
- Italic used for emphasis in a monospaced face that has no italic
  (renders as slanted upright — always wrong).
- `letter-spacing: -1px` on body text (should be 0 or em-based).
- Hotlinked `fonts.googleapis.com` in production with no self-host
  plan.
- `font-display: block` (causes invisible text during load).
- Different display face on every page — no visual identity.
