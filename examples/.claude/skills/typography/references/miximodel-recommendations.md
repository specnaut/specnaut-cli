# Miximodel — Concrete Typography Stack Recommendation

This is the synthesis. The specialist's concrete proposal for
Miximodel, derived from `principles.md`, `libre-fonts-catalog.md`,
and `performance.md`. Future "typography refresh" tasks should use
this as the baseline to argue for or against.

**Aspirational reference (Kevin-confirmed):** <https://www.vogue.fr>.
The target voice is Didone — high-contrast, hairline, classical
fashion-magazine — anchored on a Didot/Bodoni lineage for the
masthead, with a quiet sans-serif carrying UI and supporting copy.

**Language coverage (Kevin-confirmed):** English only for now. All
font bundles ship the **Latin** subset only — no Latin-Extended,
no Cyrillic, no Greek. This shaves ~15–20 % off each font file.

**Family count (Kevin-confirmed):** **Three families.** Display +
editorial body + product UI — the full editorial split.

---

## Proposed Stack — Three Variable Families

> All three are SIL OFL, self-hosted via `@fontsource-variable/*`,
> variable for single-file delivery, Latin subset only.

| Role              | Family              | License | Variable | Use                                              |
| ----------------- | ------------------- | ------- | -------- | ------------------------------------------------ |
| **Display**       | **Bodoni Moda**     | OFL 1.1 | Yes      | Hero, H1, pull quotes, landing / blog titles     |
| **Editorial body**| **Lora**            | OFL 1.1 | Yes      | Blog article body, long-form editorial copy      |
| **Product UI**    | **Inter** (current) | OFL 1.1 | Yes      | App UI, forms, captions, metadata, settings      |

This is a **display Didone serif + text serif + text sans** system.
The split lets the app stay crisp (Inter for everything product-y)
while the editorial surfaces (landing, blog, article permalinks)
shift into the Vogue-adjacent magazine register.

### Why this pairing — aligned with Vogue.fr's Didone voice

- **Bodoni Moda (display).** A contemporary revival of Giambattista
  Bodoni's Didone — the exact type lineage Vogue has used since its
  covers started favoring Didot in the 20th century. Variable opsz +
  weight axes let the same file render hairline-refined at 64 px hero
  size and still hold structure at 28 px H2. This is the most
  Vogue-authentic libre face available in 2026. Foundry:
  Indestructible Type Co., OFL 1.1.
- **Lora (body).** A calligraphic serif tuned for 18 px editorial
  body text. Different-enough-from-Bodoni to avoid "two Didones
  fighting"; warm enough to not compete with the display.
- **Inter (UI).** Already in place, stays. Inter is the correct UI
  sans of the decade. Demoting it from "only font" to "text sans"
  is the whole unlock.

### Why Bodoni Moda over Playfair Display

Playfair Display also delivers a Didone voice (Vogue-style) and is
the reflexive pick. Bodoni Moda wins on three fronts for this
specific brief:

1. **More Vogue-accurate.** Playfair is loosely Didone-inspired;
   Bodoni Moda is a literal Bodoni revival. Vogue's masthead DNA is
   Bodoni-adjacent.
2. **Less ubiquitous.** Playfair ships on every Squarespace wedding
   template. Bodoni Moda reads as a considered choice, not a default.
3. **Proper opsz axis.** Bodoni Moda's optical-size axis handles the
   hairline-disappears-at-small-sizes problem that wrecks most
   Didones below 40 px.

Keep Playfair Display as a safe fallback if Bodoni Moda fails design
review (e.g., feels "too serious"). Keep Fraunces as a third
alternative for a more modern, less classical take.

### Why not Canela / Editorial New / GT Sectra / Didot (paid)

Paid foundry faces (Commercial Type / Pangram Pangram / Grilli /
Linotype). Per Miximodel's constitution, libre-de-droit only.
Bodoni Moda + Lora + Inter deliver 90% of the same voice at $0.

---

## Proposed Tailwind v4 Tokens

Edit `inertia/css/app.css`, inside `@theme inline`:

```css
@theme inline {
  /* Keep existing --font-sans pointing at Inter Variable */
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system,
               BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* Add the editorial stack */
  --font-display: 'Bodoni Moda Variable', 'Didot', 'Bodoni 72', 'Times New Roman', serif;
  --font-serif:   'Lora Variable', Georgia, 'Times New Roman', serif;
}
```

Then drive usage from Tailwind utilities:

```tsx
// Hero headline (landing, blog permalink)
<h1 className="font-display text-5xl md:text-7xl tracking-tight">…</h1>

// Blog article body
<article className="font-serif text-lg leading-relaxed">…</article>

// Product UI (unchanged, defaults to font-sans)
<nav className="text-sm text-muted-foreground">…</nav>
```

Use `tracking-tight` (−0.02 em) on Bodoni Moda display at 40 px+ to
match the taut magazine-masthead feel.

---

## Where Each Family Is Used

| Surface                             | Display              | Body          | Other         |
| ----------------------------------- | -------------------- | ------------- | ------------- |
| Landing hero (`/`)                  | **Bodoni Moda**      | Inter (paragraphs) | —             |
| Landing body sections               | Bodoni Moda (H2)     | Inter         | —             |
| Blog index (`/blog`)                | Bodoni Moda (titles) | Inter (cards) | —             |
| Blog article (`/blog/:slug`)        | **Bodoni Moda** (title) | **Lora** (body)  | Inter (metadata) |
| Public profile (`/p/:username`)     | Inter (or Bodoni Moda for name only) | Inter | — |
| App feed / chat / settings          | Inter                | Inter         | —             |
| Legal pages (`/legal/*`)            | Bodoni Moda (H1)     | Lora OR Inter | —             |
| Emails / notifications              | System fallback      | System fallback | —           |

The decisive rule: **Bodoni Moda appears wherever editorial presence
matters. Lora appears only on long-form reading surfaces. Inter
everywhere else.**

---

## Rollout Plan (for a future refresh task — NOT this task)

This skill doesn't ship the refresh. When a future task picks it up:

1. **Install packages:**
   ```bash
   npm install @fontsource-variable/bodoni-moda @fontsource-variable/lora
   ```
2. **Add CSS imports** in `inertia/app/app.tsx` — **Latin subset only**
   (no Latin-Ext, no Cyrillic, no Greek):
   ```ts
   import '@fontsource-variable/bodoni-moda/latin.css'
   import '@fontsource-variable/lora/latin.css'
   ```
3. **Add Tailwind theme tokens** to `inertia/css/app.css` (snippet above).
4. **Apply `font-display` and `font-serif`** utilities on editorial
   surfaces only. Explicitly audit that `font-display` does NOT leak
   into product-UI components (buttons, inputs, tabs).
5. **Hairline-safety pass on Bodoni Moda.** Didone hairlines
   disappear below ~24 px and on low-contrast backgrounds. Enforce
   display usage at 32 px+ minimum; if a smaller variant is needed,
   it's the opsz axis's job — set `font-optical-sizing: auto`.
6. **Burgundy-background contrast pass.** Bodoni Moda hairlines on
   Miximodel's burgundy (`--main-color` oklch(0.47 0.13 17.71)) can
   fail WCAG AA. Test at actual production background; bump weight
   (e.g., 500 instead of 400) on any hero copy over burgundy.
7. **Audit bundle size** — before/after Lighthouse, LCP delta < 50 ms.
8. **Dark-mode pass** — drop one weight step if the display face
   looks heavier on dark background (see `principles.md` §7).

---

## Estimated Bundle Impact (English / Latin only)

| Face         | Variant bundle (Latin only, WOFF2, gzipped) |
| ------------ | ------------------------------------------- |
| Bodoni Moda  | ~85 KB variable (wght + opsz axes)          |
| Lora         | ~35 KB variable (wght + italic)             |
| Inter        | ~55 KB variable (already installed)         |

**Total: ~175 KB for three variable faces, Latin only.** Down from
the ~220 KB estimate when we assumed Latin + Latin-Ext.

---

## Accessibility Floors (Non-Negotiable)

- Blog body: `text-lg` (18 px), `leading-relaxed` (1.625), `font-normal`
  (400 weight) on Lora.
- Nav / UI: `text-sm` (14 px) minimum, `font-medium` (500) on
  interactive labels (Inter).
- Hero headline: Bodoni Moda at 40 px+ minimum. Can go to 300
  weight at 64 px+, never below.
- Never ship display or body copy below 14 px.
- **Didone hairline trap:** Bodoni Moda's thinnest strokes vanish
  against anything but a clean high-contrast background. Always
  test at the real production background before shipping.

---

## Alternatives Documented (for design-review pushback)

If design review rejects Bodoni Moda, fallbacks in order:

1. **Playfair Display** (OFL, variable). The safer Didone. Slightly
   less Vogue-accurate, more ubiquitous, but battle-tested on the
   web. Swap is one-file: `@fontsource-variable/playfair-display`.
2. **Fraunces** (OFL, variable). Contemporary high-contrast serif
   with soft/wonk/opsz axes. Moves the voice from "classical
   Vogue" to "contemporary editorial with a wink." Good if the
   Bodoni lineage feels too serious for Miximodel's tone.
3. **Cormorant Garamond** (OFL, statics only). Pushes toward
   "haute couture atelier" rather than "Vogue masthead." Not a
   variable font — budget grows per weight, cap at 3 weights.

All three are interchangeable at the token level — a future refresh
task changes `--font-display` in one place.
