# Typography — Web Performance & Delivery

Rules and concrete patterns for shipping fonts on Miximodel without
wrecking LCP, CLS, or the mobile experience.

---

## Core Rules

1. **WOFF2 only.** No TTF / WOFF / EOT. Every browser Miximodel
   supports reads WOFF2. `@fontsource*` packages already ship WOFF2
   as the default format.
2. **Variable font when available.** One file, every weight.
   Exception: if you only need two weights and the variable bundle
   is > 2× the static-pair cost, use statics.
3. **Self-host.** Use `@fontsource-variable/*` (or `@fontsource/*`)
   npm packages. Avoids `fonts.googleapis.com` third-party DNS /
   TLS cost (~200–500 ms on cold load).
4. **Subset to the scripts you actually serve.** Miximodel ships
   English only today (Kevin-confirmed) → the `latin` subset is
   enough. Do not import `latin-ext`, `cyrillic`, `greek`,
   `vietnamese`, etc. Revisit only if / when a new locale is added.
5. **Budget per face:** < 50 KB per static weight subsetted,
   < 150 KB for a variable font with Latin + Latin-Extended.
6. **Preload the hero / above-the-fold face.** The one face the
   first paint needs. Do not preload three.
7. **`font-display: swap` for body / UI**, `font-display: optional`
   for the display face where FOUT would be embarrassing.
   **Never `font-display: block`** — causes invisible text (FOIT).

---

## The Delivery Stack

### 1. Install via Fontsource

```bash
npm install @fontsource-variable/bodoni-moda @fontsource-variable/lora
# @fontsource-variable/inter is already installed — keep it
```

Each `@fontsource-variable/*` package ships:

- WOFF2 files subsetted per language (`latin`, `latin-ext`, etc.).
- CSS files with `@font-face` declarations pointing at the WOFF2.
- Optional `400.css`, `700.css` per-weight imports for static cuts.

### 2. Import only the subsets you need

In `inertia/app/app.tsx` (or wherever the root CSS imports live).
Miximodel is **English-only today** → Latin subset only:

```ts
import '@fontsource-variable/bodoni-moda/latin.css'
import '@fontsource-variable/lora/latin.css'
import '@fontsource-variable/inter/latin.css'
```

Do **not** import the package default (`@fontsource-variable/inter`
with no subset suffix) because that pulls every subset (`latin`,
`latin-ext`, `cyrillic`, etc.) and blows the budget for no reason.

### 3. Wire into Tailwind v4 theme tokens

In `inertia/css/app.css`:

```css
@theme inline {
  /* Existing */
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system,
               BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* New — editorial display and text serif */
  --font-display: 'Bodoni Moda Variable', 'Didot', 'Bodoni 72', 'Times New Roman', serif;
  --font-serif:   'Lora Variable', Georgia, 'Times New Roman', serif;
}
```

The fallback stack matters: when the WOFF2 is still loading, the
browser renders with the first available fallback. Pick fallbacks
whose metrics (x-height, width) roughly match the real font to
minimize CLS on swap.

### 4. Use size-adjust / ascent-override for zero-CLS swaps (advanced)

For Miximodel's editorial surfaces (blog, landing) where CLS matters
most, consider using the CSS `size-adjust` and `ascent-override`
descriptors on a custom `@font-face` for the fallback, so the
fallback and real font occupy the exact same bounding box. The
[Fontaine](https://github.com/unjs/fontaine) library automates this
when the budget for manual tuning runs out.

---

## Preload Strategy

Preload only the **one** face that the above-the-fold uses. Too many
preloads starves the critical path.

In `inertia/app/app.tsx`'s `<head>` (Inertia Head component):

```tsx
<link
  rel="preload"
  href="/fonts/fraunces-variable-latin.woff2"
  as="font"
  type="font/woff2"
  crossOrigin="anonymous"
/>
```

The `crossOrigin="anonymous"` attribute is **mandatory** for fonts
— without it, the preload fetches the font but then the browser
fetches it again when the CSS requests it, wasting bandwidth.

Fontsource serves fonts from `@fontsource-variable/*/files/*.woff2`;
in production (Vite) these get fingerprinted. You usually don't
preload Fontsource assets manually because the hash changes on each
build — instead, let the CSS `@font-face` kick off the fetch and
rely on `font-display: swap` for the first paint.

---

## `font-display` Decision Table

| Scenario                                  | Value      | Why                                      |
| ----------------------------------------- | ---------- | ---------------------------------------- |
| Product UI text (Inter)                   | `swap`     | Fallback shows immediately, swap on load |
| Editorial body serif (Lora on blog)       | `swap`     | Readers can start reading even pre-swap  |
| Display face (Fraunces hero headline)     | `optional` | If it takes > 100 ms, skip this load —   |
|                                           |            | fallback is acceptable for hero          |
| Monospace (code blocks)                   | `swap`     | Code is still readable in fallback       |

Fontsource defaults its CSS to `font-display: swap`. To override to
`optional` for the display face, write a custom `@font-face` block
in `inertia/css/app.css` pointing at the same Fontsource file paths,
and avoid importing the default Fontsource CSS for that face.

---

## Subsetting — When Fontsource Isn't Enough

`@fontsource-variable/*` already ships subsets (`latin`,
`latin-ext`, `cyrillic`, etc.). If you need a custom subset (e.g.,
"only the 60 glyphs used in the hero wordmark"), use:

- **subfont** (<https://github.com/Munter/subfont>) — analyzes your
  HTML and generates a unicode-range-subsetted font bundle.
- **glyphhanger** (<https://github.com/zachleat/glyphhanger>) —
  same idea, used by Filament Group.
- **fonttools** (`pyftsubset`) — the manual route for one-off
  custom subsets.

Custom subsetting is overkill for Miximodel today. Revisit only if
a Largest Contentful Paint (LCP) audit flags the hero font as the
LCP element.

---

## Size Budgets — Worked Examples

A realistic Miximodel editorial page (landing hero) with three
families loaded, **Latin subset only** (English-only content):

| Face                         | Variable? | Variant imports          | Latin-only total |
| ---------------------------- | --------- | ------------------------ | ---------------- |
| Bodoni Moda (display)        | Yes       | wght + opsz axes         | ~85 KB           |
| Lora (editorial body serif)  | Yes       | wght + italic            | ~35 KB           |
| Inter (UI sans, already in)  | Yes       | wght + slnt + opsz       | ~55 KB           |

**Total: ~175 KB gzipped WOFF2 for three variable faces, Latin only.**

For comparison, a single non-subsetted Bodoni Moda TTF is ~1 MB.
The discipline pays off at ~6× reduction.

If a future task adds a locale that requires accented characters
beyond Latin (e.g., French "é, è, ê, ç" live in `latin-ext` for
some of these families), add the `latin-ext.css` import then and
re-budget. Until then, `latin` only.

---

## Measurement

Run these checks before shipping any typography change:

1. **Lighthouse** / PageSpeed Insights — LCP should not degrade by
   more than 50 ms. CLS should stay < 0.1.
2. **WebPageTest** — confirm fonts load on the Network waterfall in
   the correct order (preload first, no render-blocking).
3. **Chrome DevTools → Coverage** — check that the imported subset
   is actually used. If > 30% of a font file is unused glyphs, the
   subset is wrong.
4. **`prefers-reduced-data`** — consider serving system fonts only
   when this media query is set. Low priority; revisit if Miximodel
   mobile traffic grows.

---

## Anti-Patterns — Stop, Turn Back

- `<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">`
  in `app.edge` or `app.tsx` for production. Costs a third-party
  DNS + TLS handshake. Use Fontsource self-hosting instead.
- `@import url('https://fonts.googleapis.com/...')` in CSS — render
  blocking.
- Loading all weights (100–900) when only 400 / 500 / 700 are used.
- Importing `@fontsource-variable/inter` full CSS index.css in a page
  component (use the root layout only).
- Using `font-display: auto` — browser defaults to `block` on some
  engines. Always be explicit.
- Adding a new font family without removing an unused one — family
  count only ever goes up without discipline.
