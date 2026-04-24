# Typography — FAQ & Libre Equivalents

Quick answers to the questions the specialist gets most often. Add
new entries as they come up.

---

## License & Commercial Use

**Q. Can I use Google Fonts commercially on Miximodel without paying?**
Yes. Every font on Google Fonts is either SIL OFL or Apache 2.0.
Both allow unrestricted commercial use, self-hosting, bundling, and
modification (Apache requires attribution in some cases; OFL has
no attribution requirement for end-use).

**Q. What's the difference between OFL and Apache 2.0 for fonts?**
Functionally identical for web usage. OFL is more common
(~95% of Google Fonts). Apache 2.0 appears on Roboto / Open Sans /
Noto families. Both permit commercial use, modification, and
redistribution.

**Q. Can I embed a libre font in a PDF export we sell?**
Yes, under OFL and Apache 2.0. You don't need a separate "embedding
license" the way you would with Monotype / Linotype commercial faces.

**Q. Someone on Dribbble used [Canela / Editorial New / GT Sectra].
Can we use it?**
Those are paid foundry faces. Miximodel's constitution (task `081`
typography expert) forbids paid foundries even as aspirational
references. Counter-offer a libre equivalent (see
`libre-fonts-catalog.md` → Hard Ban table).

**Q. Can I use a font I downloaded from Envato / Creative Market?**
Almost never libre. Those marketplaces sell commercial licenses
with per-project or per-domain fees. Treat as paid. Find a libre
alternative.

**Q. What about Adobe Fonts (ex-Typekit)?**
Paid subscription. Can't self-host (served from Adobe CDN). Licensing
terminates when the subscription stops. Not compatible with
Miximodel's libre-only rule.

---

## Libre Equivalents to Famous Paid Faces

When someone says "I want X," offer the libre alternative instead.

| Paid face                 | Libre equivalent                  | Notes                                       |
| ------------------------- | --------------------------------- | ------------------------------------------- |
| Canela (Commercial Type)  | **Fraunces** / Cormorant          | Fraunces wins for variable-font flexibility |
| Editorial New (Pangram)   | **Fraunces** (wonk axis active)   | Wonk axis replicates Editorial's quirk      |
| GT Sectra (Grilli)        | **Fraunces**                      | Both are contemporary high-contrast serifs  |
| GT America (Grilli)       | **Archivo** / Manrope             | Archivo is closer to GT America's width     |
| Söhne (Klim)              | **Work Sans** / Space Grotesk     |                                              |
| Neue Haas Grotesk         | **Archivo** / Inter               | Archivo has the width axis                  |
| ABC Diatype (Dinamo)      | **Inter** / Manrope               |                                              |
| Graphik (Commercial Type) | **Work Sans** / Space Grotesk     |                                              |
| Didot (URW)               | **Playfair Display** / Cormorant  |                                              |
| Bodoni                    | **Playfair Display**              |                                              |
| Futura                    | **Archivo** (geometric weights)   |                                              |
| Gill Sans                 | **Work Sans**                     | Close humanist match                        |
| Helvetica Neue            | **Inter** / Archivo               | Inter is a better web-native pick           |
| Garamond (ITC / Adobe)    | **Cormorant Garamond**            |                                              |
| Caslon (Adobe)            | **Libre Caslon**                  |                                              |
| Baskerville (Monotype)    | **Libre Baskerville**             |                                              |

---

## Implementation Questions

**Q. Do I need to preload every font I import?**
No. Preload at most one — the face the first paint actually uses
(usually the display face on the landing hero). Too many preloads
starve the critical path.

**Q. Should I use Google Fonts CDN or self-host with Fontsource?**
**Self-host with Fontsource** in production. Google Fonts CDN costs
a third-party DNS + TLS handshake (200–500 ms cold). Also, the
`fonts.googleapis.com` endpoint is blocked in some networks.
Fontsource = same fonts, self-hosted, versioned via npm.

**Q. `font-display: swap` or `optional`?**
- `swap` for body / UI (readers can start reading with fallback).
- `optional` for display faces where FOUT looks bad (hero title).
- **Never `block`** — produces invisible text (FOIT).

**Q. What's the right way to handle FOUT / FOIT?**
1. Use `font-display: swap` (or `optional` for display).
2. Pick fallback stacks whose metrics match the real font to
   minimize CLS on swap.
3. For editorial pages where CLS matters most, use
   [Fontaine](https://github.com/unjs/fontaine) to auto-tune
   `size-adjust` + `ascent-override` on a fallback `@font-face`.

**Q. How do I add a new font family to Miximodel?**
Follow the pattern in `performance.md` §"The Delivery Stack":
1. `npm install @fontsource-variable/<family>`.
2. Import the subset CSS in `inertia/app/app.tsx`.
3. Add the `@theme` token in `inertia/css/app.css`.
4. Apply via Tailwind `font-<role>` utilities on the surfaces that
   should use it.
5. Audit bundle size + Lighthouse before merging.

**Q. Is `font-family: system-ui` acceptable?**
Only as a fallback in the stack. Shipping `system-ui` as the entire
brand font is admitting defeat — Miximodel is fashion, not a
terminal emulator. Use `system-ui` in the fallback chain behind the
real brand face.

---

## Editorial / Design Questions

**Q. How do I know if a pairing is working?**
The Contrast Test (from `principles.md`): can a reader tell which
family is display vs text at the same size, without being told?
If not, the pairing doesn't have enough contrast.

**Q. Is three families too many?**
In editorial products with a true display + body + UI split, three
is the legitimate max. Four is always wrong. Miximodel's proposed
stack (Fraunces + Lora + Inter) is three and is justified; see
`miximodel-recommendations.md` for the trade-off against two.

**Q. Why does our current UI feel "generic SaaS"?**
Because it ships a single sans-serif (Inter) across every surface,
including editorial ones. Inter is correct for the app UI and
completely wrong for the hero headline. The fix is to add a display
face and a text serif — not to replace Inter.

**Q. Can I mix two serifs?**
Yes, if they're from different eras and one is clearly display-only.
Cormorant Garamond (Didone-ish, display) + Libre Baskerville
(transitional, body) works. Two Didone serifs or two Garalde serifs
at similar contrast clash.

**Q. When should I use italic?**
- In running text: titles of works, foreign words, emphasis
  (sparingly). Don't use italic for quotes — use quotation marks.
- As a display variant: fashion-magazine pull quotes often use
  italics for character. Fraunces's italic is particularly well-drawn.
- Never in monospace faces that lack a true italic cut (renders as
  slanted upright — always wrong).

**Q. When do I use small caps?**
- Acronyms in running text (MIXIMODEL, CCBILL) — small caps avoid
  the visual-shout of ALL CAPS.
- Proper nouns in editorial contexts (e.g., author names in a
  byline).
- Don't use CSS `font-variant: small-caps` if the font lacks true
  small caps — faked small caps look lighter than the surrounding
  text and always read wrong.

---

## Accessibility Questions

**Q. What's the minimum body text size?**
16 px (1 rem). Smaller fails WCAG success criteria because it forces
zooming and degrades mobile legibility.

**Q. What's the minimum body weight?**
400 (Regular). Weights below 400 (Thin, ExtraLight, Light) look
fashionable but wreck legibility, especially on dark backgrounds.

**Q. Are there dyslexia-friendly libre fonts?**
Yes: **Atkinson Hyperlegible** (Braille Institute, OFL) and
**Lexend** (Apache 2.0) are both libre and explicitly tuned for
low-vision / dyslexia readers. Miximodel doesn't ship a
typography-preference toggle today; revisit if an a11y options
panel gets added.

**Q. How do I check contrast of a hairline serif on a dark
background?**
Render the text at production size against the actual production
background color, then run WebAIM contrast checker. Don't trust
"contrast at 24 px is fine" — a hairline serif's effective contrast
drops dramatically below 18 px because the hairlines start losing
pixels.

---

## Miximodel-Specific Context

**Q. What font does Miximodel currently use?**
As of task `081` creation: `Inter Variable` only, wired via
`@fontsource-variable/inter` and the `--font-sans` token in
`inertia/css/app.css`. No display face, no editorial serif. This
is exactly the gap this agent / skill exists to close.

**Q. What brand colors are we working against?**
Burgundy + gold + cream (landing refresh tasks `033`, `054`, `070`,
`075`). Type choices should flatter these. Very high-contrast
hairline serifs risk disappearing on burgundy; test against actual
burgundy backgrounds.

**Q. Is the blog already styled?**
Partially (tasks `035`, `080`). The blog uses `@tailwindcss/typography`
for `.prose` styling but still defaults to `font-sans` (Inter) for
body. The proposed refresh would swap blog body to `font-serif`
(Lora) while keeping the rest of the app on Inter.

**Q. Is there a design system documentation page?**
Task `079` is in the backlog for a `/design-system` route. The
typography section of that page will consume this skill's guidance
once it's built.

**Q. What language does Miximodel ship in?**
English only today (Kevin-confirmed, task `081`). All font bundles
use the `latin` subset only — no `latin-ext`, no `cyrillic`, no
`greek`. Saves ~15–20 % per font file vs. multi-subset bundles.
Revisit this assumption if / when a new locale is added.

**Q. What's the aspirational typography reference for Miximodel?**
<https://www.vogue.fr> (Kevin-confirmed). Didone lineage —
Didot/Bodoni high-contrast classical fashion-magazine voice. See
`miximodel-recommendations.md` for the concrete libre match
(Bodoni Moda as primary, Playfair Display as safer fallback,
Fraunces as more-modern alternative).
