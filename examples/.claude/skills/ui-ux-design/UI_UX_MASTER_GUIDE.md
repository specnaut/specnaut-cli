# 🎨 UI/UX Design Mastery Guide for QuickPost

**Compiled:** 2026-02-05  
**Purpose:** Build beautiful, modern web designs before starting MVP

---

## 📐 CORE DESIGN PRINCIPLES (2026)

### 1. **Mobile-First, Always**

- Start with 320px width (smallest phone)
- Progressive enhancement for larger screens
- Breakpoints: 576px (phone), 768px (tablet), 992px (laptop), 1200px (desktop)
- Single-column layout default, expand only when space allows

### 2. **Visual Hierarchy**

**The Goal:** Guide user attention to what matters most

**Techniques:**

- **Size:** Larger = more important (H1 > H2 > body text)
- **Color:** Bright/contrasting = attention (CTAs should pop)
- **Whitespace:** More space around = more emphasis
- **Proximity:** Related items grouped together
- **Contrast:** Dark on light or light on dark (never low contrast)

**Reading Patterns:**

- **Z-pattern:** Logo (top-left) → CTA (top-right) → Content (middle-left) → Final CTA (bottom-right)
- **F-pattern:** Scan headline, then first line of each section

### 3. **Whitespace is Your Weapon**

**Never fear empty space.** It's not wasted—it's intentional.

**Rules:**

- More whitespace = premium feel (Apple, Stripe vibes)
- Crowded design = stress, cheap, overwhelming
- Space elements in multiples of 8px (8, 16, 24, 32, 48, 64)
- Breathing room between sections: 48-64px minimum
- Padding inside cards: 24-32px

**Hick's Law:** More choices = slower decisions. Use whitespace to limit visual noise.

---

## 🎨 COLOR SYSTEM

### The Formula

Build a **primary color scale** (50-900) for consistency:

**Example: Blue Primary**

```
blue-50:  #eff6ff (lightest, backgrounds)
blue-100: #dbeafe
blue-200: #bfdbfe
blue-300: #93c5fd
blue-400: #60a5fa
blue-500: #3b82f6 (base brand color)
blue-600: #2563eb
blue-700: #1d4ed8
blue-800: #1e40af
blue-900: #1e3a8a (darkest, text on light backgrounds)
```

**Palette Structure:**

1. **Primary:** Your brand color (CTAs, links, active states)
2. **Neutrals:** Grays 50-900 (text, backgrounds, borders)
3. **Success:** Green (confirmations, checkmarks)
4. **Error:** Red (warnings, destructive actions)
5. **Warning:** Yellow/Orange (alerts)

**Modern 2026 Trends:**

- **Soft gradients** as backgrounds (not loud 2015 gradients, subtle ambient color shifts)
- **Cinematic color fields** (inspired by lighting/fog effects)
- **High saturation for CTAs** (makes them unmissable)

**Tools:**

- Huevy.app (generates complete palettes)
- Coolors.co (palette generator)
- Adobe Color (harmony rules)

---

## 📝 TYPOGRAPHY

### Scale (8px baseline)

Use a **modular scale** for consistent hierarchy:

```
text-xs:   12px / 16px line-height
text-sm:   14px / 20px
text-base: 16px / 24px (body text default)
text-lg:   18px / 28px
text-xl:   20px / 28px
text-2xl:  24px / 32px
text-3xl:  30px / 36px (section headers)
text-4xl:  36px / 40px
text-5xl:  48px / 1 (hero titles)
```

### Font Pairing

**2 fonts max:**

1. **Sans-serif** for UI (buttons, labels, body) — Inter, SF Pro, Geist
2. **Serif** (optional) for headings if premium feel — Playfair, Merriweather

**Safe System Stack (no web fonts, blazing fast):**

```css
font-family:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### Readability Rules

- **Line length:** 50-75 characters per line (anything longer = hard to read)
- **Line height:** 1.5x for body text, 1.2x for headings
- **Letter spacing:** Tight for headings (-0.02em), normal for body

---

## 🏗️ LAYOUT PATTERNS

### CSS Grid (Page Structure)

Use for **2D layouts** (header, sidebar, main, footer):

```css
.dashboard {
  display: grid;
  gap: 1rem;

  /* Mobile: stack everything */
  grid-template-areas:
    'header'
    'nav'
    'main';

  /* Tablet: side nav */
  @media (min-width: 768px) {
    grid-template-areas:
      'header header'
      'nav main';
    grid-template-columns: 250px 1fr;
  }

  /* Desktop: three columns */
  @media (min-width: 1024px) {
    grid-template-areas:
      'header header header'
      'nav main sidebar';
    grid-template-columns: 250px 1fr 300px;
  }
}
```

### Flexbox (Components)

Use for **1D layouts** (rows/columns within cards):

```css
/* Card with image + content side-by-side */
.card {
  display: flex;
  gap: 1rem;
  align-items: center; /* vertically center */
}

/* Responsive: stack on mobile */
@media (max-width: 576px) {
  .card {
    flex-direction: column;
  }
}
```

### Responsive Grid (Auto-fit)

**No media queries needed** for simple grids:

```css
.grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
```

Auto-wraps when items don't fit!

---

## ⚡ MICRO-INTERACTIONS

Subtle animations that make UI feel alive (not distracting).

### When to Use

- **Hover:** Buttons scale up 1.05x (feels clickable)
- **Click:** Buttons scale down to 0.95x (tactile feedback)
- **Loading:** Skeleton screens or pulse animations
- **Success:** Checkmark fade-in, confetti (for big wins)
- **Error:** Shake animation (subtle, 2px left-right)

### Framer Motion (React)

```jsx
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  transition={{ type: 'spring', stiffness: 300 }}
>
  Schedule Post
</motion.button>
```

### CSS Transitions (Simple)

```css
.button {
  transition: all 0.2s ease-in-out;
}

.button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

### Best Practices

- **Keep it subtle:** 0.2-0.3s duration max
- **Spring physics > linear:** Feels more natural
- **Avoid animation overload:** Only animate meaningful interactions
- **Performance:** Animate `transform` and `opacity` only (GPU accelerated)

---

## ♿ ACCESSIBILITY (WCAG 2.2)

### Contrast Ratios (MANDATORY)

Test every color combination:

- **Normal text (16px):** 4.5:1 minimum
- **Large text (24px or 19px bold):** 3:1 minimum
- **UI components (buttons, inputs):** 3:1 minimum

**Tools:**

- Coolors Contrast Checker (https://coolors.co/contrast-checker/) — pair two
  hex values from a palette and read the ratio directly. Works on the URL
  itself (e.g. `/contrast-checker/112a46-acc8e5`).
- WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/) —
  identical math, alternative UI.

### Color Accessibility Theory

Contrast checking after the fact is firefighting — you keep finding pairs
that fail and patching them. Design the palette to be accessible from the
start and the audit becomes a confirmation, not a rescue.

**1. Pick hue and lightness together, not just hue.**

Two colors of the same lightness will never have enough contrast no matter
how different the hue. WCAG contrast is luminance-based — it ignores hue
entirely. Heuristics:

- Pair a **dark** (Y < 0.2) with a **light** (Y > 0.5) value. The Y gap
  drives the ratio.
- Same-family pairs (two teals, two reds) only work when the lightness gap
  is large. Two mid-saturation greens at the same lightness will sit at
  ~1.2:1 — invisible.
- Pure white on pure black is 21:1. You almost never need that; aim for
  the AA floor (4.5:1 normal text, 3:1 large text and UI boundaries) and
  go up only where it matters.

**2. Worked examples — proposed palette**

Palette: `#160F29` (navy) · `#246A73` (teal) · `#368F8B` (light teal) ·
`#F3DFC1` (cream) · `#DDBEA8` (beige). Validate any of the pairs below at
https://coolors.co/contrast-checker/ by editing the two hex values in the
URL.

| Foreground   | Background   | Ratio      | Verdict                                          |
| ------------ | ------------ | ---------- | ------------------------------------------------ |
| `#F3DFC1` cream | `#160F29` navy | **14.0:1** | AAA on everything — body text, captions, badges. |
| `#160F29` navy | `#368F8B` light teal | **4.8:1** | AA normal text. Safe for button labels on the primary surface. |
| `#DDBEA8` beige | `#246A73` teal | **3.6:1** | AA large text and AA UI components only. **Not** for normal-size body text — flag this in code review. |

The third row is the trap that bites teams: it "passes 3:1" so it ships,
then a contrast audit flags every paragraph rendered in beige on teal.
Encode the role in the token name — `--color-on-primary-large` vs.
`--color-on-primary-body` — so the wrong pair can't be used by accident.

**3. Color-blindness safety**

Roughly 8% of men and 0.5% of women have some form of color-vision
deficiency — deuteranopia (green-weak) and protanopia (red-weak) are the
common ones. Two rules:

- **Never communicate state with hue alone.** A red dot and a green dot
  look identical to a deuteranope. Pair the hue with a glyph (✓ / ✗), a
  position (left = error, right = success), or a label.
- **Test the palette under simulation.** Coolors has a "Color blindness"
  view on every palette; Sim Daltonism (Mac) and Chrome DevTools'
  Rendering panel both apply live filters.

**4. The 60-30-10 rule, accessibility-aware**

The classic interior-design rule (60% dominant, 30% secondary, 10% accent)
works for UI when each share maps to a contrast role:

- **60% dominant** — page background and large surfaces. Pick from the
  lightest two values (`#F3DFC1`, `#DDBEA8`) in light mode, or the darkest
  (`#160F29`, `#246A73`) in dark mode.
- **30% secondary** — cards, panels, dividers. One step closer to the
  dominant in luminance so it reads as elevation, not contrast (e.g.
  cream on beige).
- **10% accent** — CTAs, links, focus rings. Must clear 3:1 against the
  dominant (WCAG 1.4.11). The teal pair (`#246A73` / `#368F8B`) is the
  accent role in this palette because it sits in the contrast valley
  between cream/beige and navy.

If your accent fails 3:1 against the dominant, you have the wrong accent —
not the wrong CTA design.

**5. Semantic meaning vs. cultural perception**

Red = error, green = success is a Western convention, not a universal one.
In China red signals luck and prosperity; in some financial UIs around the
world red signals *upward* movement. Two consequences:

- Don't lean on the convention to do the work — always pair with text or
  an icon. ("Payment failed" + red is fine; red alone is not.)
- If the product ships in multiple locales, audit the palette against the
  target cultures. The accessibility cost is the same either way; the
  cultural cost compounds.

The contrast checker tells you whether the pair is *legible*. It can't
tell you whether the pair is *meaningful* to the user in front of it.

### Keyboard Navigation

**Every interactive element must be keyboard-accessible:**

- Tab through in logical order
- Focus states visible (3:1 contrast vs unfocused)
- Enter/Space activates buttons
- Escape closes modals

```css
/* Visible focus indicator */
button:focus-visible {
  outline: 3px solid #3b82f6;
  outline-offset: 2px;
}
```

### ARIA Labels

```jsx
<button aria-label="Schedule post for tomorrow at 9 AM">
  Schedule
</button>

<img src="logo.png" alt="QuickPost - Social media scheduler" />
```

### Screen Reader Testing

- Install NVDA (Windows) or VoiceOver (Mac)
- Navigate your UI with screen reader on
- Fix anything confusing or unlabeled

---

## 🎨 SHADCN/UI + TAILWIND STACK

### Why This Combo?

- **Shadcn/ui:** Pre-built, accessible components (buttons, modals, dropdowns)
- **Tailwind CSS:** Utility-first styling (no custom CSS files)
- **Radix UI:** Unstyled, accessible primitives (under the hood)

### Setup (Next.js)

```bash
npx create-next-app@latest quickpost --typescript --tailwind --app
cd quickpost
npx shadcn@latest init
```

Choose:

- **Style:** Default
- **Base color:** Blue (or custom)
- **CSS variables:** Yes

### Adding Components

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add calendar
```

Components appear in `components/ui/` — **you own the code, customize freely.**

### Component Structure

```
/components
  /ui              # Shadcn components (button, card, etc.)
  /layout          # Navbar, footer, sidebar
  /features        # Upload, calendar, post-preview
  /shared          # Reusable custom components
```

### Tailwind Best Practices

**Use design tokens (not arbitrary values):**

```jsx
// ❌ Bad (arbitrary)
<div className="p-[17px] text-[#3f51b5]">

// ✅ Good (system tokens)
<div className="p-4 text-blue-600">
```

**Responsive design:**

```jsx
<div className="
  w-full           /* mobile: full width */
  md:w-1/2         /* tablet: half width */
  lg:w-1/3         /* desktop: one-third width */
">
```

---

## 📦 COMPONENT LIBRARY TEMPLATES

### 1. **Mosaic (Cruip)**

- Premium Tailwind dashboard template
- Beautiful data visualizations (Chart.js)
- Dark mode built-in
- Free & Pro versions
- **Use for:** SaaS dashboards, analytics

### 2. **TailAdmin**

- 500+ components
- CRM, e-commerce, analytics layouts
- Open source
- React, Next.js, Vue, Angular support
- **Use for:** Admin panels, CRMs

### 3. **Flowbite**

- 50+ example pages
- Kanban boards, calendars, CRUD pages
- Built on Tailwind
- **Use for:** Full-stack admin UIs

### 4. **Horizon UI**

- Modern, gradient-heavy design
- Dark mode
- TypeScript + React
- **Use for:** Trendy, colorful interfaces

---

## 🎯 QUICKPOST-SPECIFIC DESIGN DECISIONS

### Design Philosophy

**"Buffer quality, but dead simple"**

- Clean, minimal UI (no bloat)
- Fast interactions (< 3 clicks to schedule)
- Visual feedback at every step
- Mobile-first (creators post from phones)

### Color Palette

```
Primary (Brand):   Purple #8b5cf6 (creative, modern)
Success:           Green #10b981 (post scheduled!)
Neutral:           Gray 50-900 (backgrounds, text)
Background:        White #ffffff / Dark #0f172a
```

### Key Screens

1. **Upload:** Drag-and-drop zone (large, obvious)
2. **Caption:** Textarea with character counter
3. **Calendar:** Visual picker (shadcn calendar component)
4. **Preview:** Show exactly how post will look
5. **Success:** Checkmark animation + confirmation

### Typography

- **Headings:** Inter 600 (semi-bold)
- **Body:** Inter 400 (regular)
- **Monospace:** Jetbrains Mono (for metadata, timestamps)

### Micro-interactions

- **Upload zone:** Pulse border on hover
- **Schedule button:** Scale 1.05 on hover, confetti on success
- **Calendar:** Smooth slide-in animation
- **Image preview:** Lazy load with blur-up effect

---

## ✅ PRE-BUILD CHECKLIST

Before writing code, confirm:

- [ ] Color palette defined (primary + 4 neutrals minimum)
- [ ] Typography scale chosen (6-8 sizes)
- [ ] Component library picked (Shadcn + Tailwind)
- [ ] Mobile breakpoints planned (576px, 768px, 992px)
- [ ] Accessibility contrast ratios checked (4.5:1 text, 3:1 UI)
- [ ] Micro-interaction list (hover, click, success states)
- [ ] Grid layout sketched (mobile → desktop progression)

---

## 🚀 INSPIRATION SOURCES

**Real Products to Study:**

- **Linear** (linear.app) — Best keyboard-first UI, subtle animations
- **Stripe Dashboard** — Clean data visualization, perfect spacing
- **Vercel** — Minimalist, fast, modern gradients
- **Notion** — Intuitive drag-and-drop, clear hierarchy
- **Loom** — Video upload flow (great for QuickPost upload UX)

**Design Systems:**

- Material Design 3 (Google)
- Human Interface Guidelines (Apple)
- Radix Themes (our base)
- Tailwind UI (paid, but worth studying)

**Dribbble Tags:**

- "social media scheduler"
- "SaaS dashboard"
- "upload interface"
- "calendar UI"

---

## 📚 FURTHER READING

**Must-Read Articles:**

1. "The Ultimate Guide to UI Design in 2026" — Web Designer Depot (Medium)
2. "Designing Overview of Scheduled Content for Buffer" — UX Collective (case study)
3. "Visual Hierarchy: Key UX Principles" — Sessions College
4. "Creating Micro-Interactions with Framer Motion" — egghead.io

**Tools:**

- **Figma:** Design mockups before coding
- **Contrast Checker:** WebAIM (accessibility)
- **Color Palette Generator:** Coolors, Huevy
- **Component Inspector:** Inspect real sites (Chrome DevTools)

---

## 🎨 FINAL DESIGN PRINCIPLES

**The 5 Laws of Beautiful UI:**

1. **Contrast creates hierarchy** (big vs small, dark vs light)
2. **Whitespace creates calm** (never fear empty space)
3. **Consistency builds trust** (same patterns repeated)
4. **Feedback confirms action** (animations, success messages)
5. **Accessibility includes everyone** (contrast, keyboard, screen readers)

---

**STATUS:** ✅ Ready to build QuickPost with world-class UI/UX

**Next Step:** Review this guide, then signal to start coding. 💥
