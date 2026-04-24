# Libre Fonts Catalog — Curated for Fashion + Photography Editorial

Every font in this catalog is **libre-de-droit** (SIL Open Font License,
Apache 2.0, or Ubuntu Font License). Safe for commercial use, can be
self-hosted via `@fontsource*` npm packages, no per-domain fees, no
foundry relationship required.

Fonts are grouped by role (display / text serif / text sans-serif /
mono). Within each group they are sorted from "most editorially
distinctive" to "most neutral." Pick the distinctiveness that matches
the surface — hero wants distinctive, product UI wants neutral.

For each font:

- **License** — OFL / Apache 2.0 / UFL.
- **Variable** — Yes / No (prefer Yes).
- **Fontsource pkg** — npm package name for self-hosting.
- **Budget** — rough WOFF2 size for Latin + Latin-Extended, subsetted.
- **Why it works** — what editorial / fashion role it fits.
- **Libre equivalent to** — when the face is a practical substitute for
  a famous paid-foundry typeface.

---

## Display Serifs — Hero, Masthead, Pull Quotes

These are your "fashion magazine" display faces. High contrast,
expressive, meant for 40 px+.

### 1. Fraunces (OFL) ⭐ recommended default

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, soft, wonk, opsz axes)
- **Fontsource pkg:** `@fontsource-variable/fraunces`
- **Budget:** ~130 KB variable (Latin + Latin-Extended, subsetted).
- **Why it works:** Contemporary high-contrast serif with
  "soft"/"wonk" stylistic axes that let the same file feel either
  refined or quirky. Reads luxurious at 60 px+; holds up at 32 px.
  Designed by Undercase Type for display and editorial usage.
- **Libre equivalent to:** Canela (Commercial Type), GT Sectra
  (Grilli), Editorial New (Pangram Pangram paid cuts).

### 2. Playfair Display (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, italic)
- **Fontsource pkg:** `@fontsource-variable/playfair-display`
- **Budget:** ~120 KB variable.
- **Why it works:** The most-used editorial display serif on the web
  for a reason — hairline contrast, generous italic, reads "fashion
  magazine" at first glance. The obvious pick, which also means
  "overused" — use with deliberate opinion.
- **Libre equivalent to:** Didot, Bodoni.

### 3. Cormorant (OFL) / Cormorant Garamond

- **License:** SIL Open Font License 1.1
- **Variable:** No (static weights 300–700 + italics)
- **Fontsource pkg:** `@fontsource/cormorant`
- **Budget:** ~40 KB per weight subsetted → plan ≤ 3 weights.
- **Why it works:** Extreme hairline contrast, sharp unbracketed
  serifs, a "Garamond for fashion editorials." Shines at 48 px+;
  breaks below 20 px.
- **Libre equivalent to:** GT Sectra Display, Canela.
- **Caution:** Not a variable font — cost grows per weight.

### 4. DM Serif Display (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** No (single weight 400 + italic)
- **Fontsource pkg:** `@fontsource/dm-serif-display`
- **Budget:** ~35 KB subsetted.
- **Why it works:** A warm, contemporary high-contrast serif that
  doesn't scream "Didot revival." Good for a less-classic editorial
  voice. Hero-size only.

### 5. Libre Caslon Display (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** No (single weight 400)
- **Fontsource pkg:** `@fontsource/libre-caslon-display`
- **Budget:** ~35 KB.
- **Why it works:** A refined 18th-century display Caslon — feels
  "couture atelier" rather than "modern magazine." Pair with a
  geometric sans for a vintage-fashion voice.

---

## Text Serifs — Long-form Editorial Body

These are the faces you trust for 3 000 words of editorial copy.
Modest contrast, generous x-height, comfortable at 16–20 px.

### 1. Lora (OFL) ⭐ recommended default for blog body

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, italic)
- **Fontsource pkg:** `@fontsource-variable/lora`
- **Budget:** ~90 KB variable.
- **Why it works:** Calligraphic, warm serif explicitly tuned for
  editorial body text. Reads beautifully at 18 px. Italic is
  particularly well-drawn.

### 2. Source Serif 4 (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (opsz, weight, italic)
- **Fontsource pkg:** `@fontsource-variable/source-serif-4`
- **Budget:** ~140 KB variable with opsz axis.
- **Why it works:** Adobe-designed optical-size-aware serif. The
  opsz axis means the same file renders correctly at 10 px, 16 px,
  and 72 px. Rigorous pick for a content-heavy editorial.

### 3. Libre Baskerville (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** No (400, 400 italic, 700)
- **Fontsource pkg:** `@fontsource/libre-baskerville`
- **Budget:** ~30 KB per weight.
- **Why it works:** A web-optimized Baskerville. Classic, safe,
  well-spaced for screen. The least risky "I need a serif body" pick.

### 4. Crimson Pro (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, italic)
- **Fontsource pkg:** `@fontsource-variable/crimson-pro`
- **Budget:** ~110 KB variable.
- **Why it works:** Old-style book face updated for screens. Feels
  "literary magazine" — good for long essays, less fashion-glossy.

---

## Text Sans-Serifs — UI, Captions, Supporting Copy, Navigation

These carry the product surfaces. Neutral, legible, reliable.

### 1. Inter (OFL) ⭐ current Miximodel default — keep for UI

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, slnt, opsz)
- **Fontsource pkg:** `@fontsource-variable/inter` *(already installed)*
- **Budget:** ~140 KB variable.
- **Why it works:** The most-tuned-for-UI humanist sans of the last
  decade. Excellent at 13–16 px in product UI. Already wired into
  Miximodel via `inertia/css/app.css`. Don't remove it — demote it
  from "only font" to "UI text sans-serif."

### 2. Work Sans (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, italic)
- **Fontsource pkg:** `@fontsource-variable/work-sans`
- **Budget:** ~90 KB variable.
- **Why it works:** Slightly more humanist than Inter, with a
  warmer geometric personality. A touch more editorial feel without
  losing UI neutrality.

### 3. Space Grotesk (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight)
- **Fontsource pkg:** `@fontsource-variable/space-grotesk`
- **Budget:** ~85 KB variable.
- **Why it works:** Proportional sibling of Space Mono. Has a
  contemporary "magazine brand system" feel — good if you want the
  sans-serif to carry display duty too (sans-first editorial).
- **Libre equivalent to:** Graphik, Söhne (light interpretation).

### 4. Manrope (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight)
- **Fontsource pkg:** `@fontsource-variable/manrope`
- **Budget:** ~100 KB variable.
- **Why it works:** Modern geometric with a subtle humanist bend.
  Slightly more stylish than Inter; still works for UI.

### 5. Archivo (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** Yes (weight, width, italic)
- **Fontsource pkg:** `@fontsource-variable/archivo`
- **Budget:** ~130 KB variable (with width axis).
- **Why it works:** Has a true variable width axis — Archivo
  Condensed and Archivo Narrow are the same file. Useful for
  editorial labels / eyebrows / infographic headings where condensed
  typography is part of the magazine voice.

---

## Monospace — Code, Tabular Numbers

Only needed if Miximodel adds code blocks (engineering blog) or
tabular financial / metric displays. Today: not required.

### 1. JetBrains Mono (Apache 2.0)

- **License:** Apache License 2.0
- **Variable:** Yes (weight, italic)
- **Fontsource pkg:** `@fontsource-variable/jetbrains-mono`
- **Budget:** ~120 KB variable.

### 2. IBM Plex Mono (OFL)

- **License:** SIL Open Font License 1.1
- **Variable:** No (static weights)
- **Fontsource pkg:** `@fontsource/ibm-plex-mono`
- **Budget:** ~35 KB per weight.

---

## Distinctive Libre Foundries Beyond Google Fonts

When Google Fonts feels too "obvious," these foundries ship genuinely
editorial libre releases — same licensing, more character. None of
them require payment.

- **Velvetyne** — <https://velvetyne.fr> — French libre foundry,
  distinctive display faces. Explicitly OFL. Strong for fashion-art
  cross-over: *Eczar*, *Grotesque*, *Basteleur*, *Cirruscumulus*.
- **Uncut.wtf** — <https://uncut.wtf> — Curated libre catalog.
  Stronger editorial display selection than Google Fonts.
- **Indian Type Foundry (free releases only)** — <https://www.indiantypefoundry.com>
  — Most ITF releases are paid; a small set is OFL. Verify each
  license manually, never assume.
- **Collletttivo** — <https://www.collletttivo.it> — Italian libre
  foundry, strong editorial display.
- **Use & Modify** — <https://usemodify.com> — Libre type catalog
  curated by Raphaël Bastide.

**Before using any font from these foundries:**

1. Read the LICENSE file in the download bundle.
2. Confirm OFL / Apache 2.0 / UFL — no custom "non-commercial" clauses.
3. Self-host (no external CDN). Add to `public/fonts/` or vendor
   into an `@fontsource`-style local package.
4. Serve WOFF2 only.

---

## Hard Ban — Paid Foundries You'll Be Asked About

These come up because they're famous in fashion / editorial web
design. **All are paid-license. Never recommend even "aspirationally."**

| Paid face              | Foundry           | Libre substitute              |
| ---------------------- | ----------------- | ----------------------------- |
| Canela                 | Commercial Type   | Fraunces / Cormorant          |
| Editorial New          | Pangram Pangram   | Fraunces (w/ wonk axis) / Cormorant |
| GT Sectra              | Grilli Type       | Fraunces / Playfair Display   |
| GT America             | Grilli Type       | Archivo / Manrope             |
| Söhne                  | Klim              | Space Grotesk / Work Sans     |
| ABC Diatype            | Dinamo            | Inter / Manrope               |
| Graphik                | Commercial Type   | Work Sans / Space Grotesk     |
| Neue Haas Grotesk      | Linotype          | Archivo / Inter               |
| Didot (URW)            | Various           | Playfair Display / Cormorant  |
| Bodoni                 | Various           | Playfair Display              |
| Futura                 | Neufville         | Archivo (geometric weights)   |

If the user insists on a paid face, explain (1) the cost (Canela
alone is ~$400+ per weight on web), (2) the per-domain licensing
complexity, (3) that the libre substitute is 90% of the same voice
for $0, and (4) Miximodel's constitution says libre-only.
