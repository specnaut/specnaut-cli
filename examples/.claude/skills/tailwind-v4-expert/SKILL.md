---
name: tailwind-v4-expert
description: Expert guidance on Tailwind CSS V4 syntax, specifically focusing on the correct usage of CSS variables.
---

# Tailwind CSS V4 Expert

This skill provides mandatory guidelines for using Tailwind CSS V4 in this
project. You must follow these rules whenever you write or modify Tailwind CSS
classes.

## 🚨 CRITICAL RULE: CSS Variables Syntax

In Tailwind CSS V4, when using CSS variables as values for utility classes, you
**MUST use parentheses `()`**, not brackets `[]`.

### ✅ Correct Usage

Use parentheses for CSS variables:

- `bg-(--my-color)`
- `text-(--text-primary)`
- `gap-(--spacing-4)`
- `w-(--sidebar-width)`
- `border-(--border-color)`

### ❌ Incorrect Usage (DO NOT USE)

Do NOT use brackets for CSS variables. These will be treated as literal strings
or invalid values:

- `bg-[--my-color]`
- `text-[--text-primary]`
- `gap-[--spacing-4]`

## ⚠️ Special Cases

### Font Size

When using a CSS variable for font size, you must use the `length:` modifier
within brackets if the variable represents a length:

- `text-[length:--font-size-base]`
- `text-[length:--text-xl]`

### Opacity

To apply opacity to a color variable, use the slash `/` syntax after the
parentheses:

- `bg-(--primary)/50`
- `text-(--secondary)/80`
- `border-(--accent)/20`

### Arbitrary Values (Non-Variables)

Brackets `[]` are still used for arbitrary literal values (pixels, rems,
percentages, etc.), just not for CSS variables:

- `w-[350px]` (Correct: literal value)
- `mt-[10.5rem]` (Correct: literal value)
- `bg-[#ff0000]` (Correct: literal hex color)

## Summary Table

| Intent                | Syntax                    | Example                   |
| :-------------------- | :------------------------ | :------------------------ |
| **Use CSS Variable**  | `utility-(--var)`         | `p-(--spacing-4)`         |
| **Arbitrary Literal** | `utility-[value]`         | `p-[16px]`                |
| **Font Size Var**     | `text-[length:--var]`     | `text-[length:--size-lg]` |
| **Opacity**           | `utility-(--var)/opacity` | `bg-(--brand)/50`         |

## 🚨 Container Queries — Prefer Over Media Queries

**For components**, always prefer container queries (`@container` + `@sm:`,
`@md:`, etc.) over media queries (`sm:`, `md:`, etc.). Container queries make
components adapt to **their parent's size**, not the viewport. This makes them
truly reusable in any layout context.

### Basic usage

```tsx
// The parent declares itself as a container
<div className="@container">
  {/* Children use @-prefixed breakpoints */}
  <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3">
    <Card />
    <Card />
    <Card />
  </div>
</div>
```

### Named containers

For nested containers, use named containers to avoid ambiguity:

```tsx
<div className="@container/sidebar">
  <div className="@container/main">
    <div className="hidden @sm/sidebar:block">Sidebar content</div>
    <div className="@md/main:grid-cols-2">Main content</div>
  </div>
</div>
```

### Container query breakpoints

| Prefix  | Min width | Equivalent to |
| :------ | :-------- | :------------ |
| `@xs:`  | 320px     | —             |
| `@sm:`  | 384px     | —             |
| `@md:`  | 448px     | —             |
| `@lg:`  | 512px     | —             |
| `@xl:`  | 576px     | —             |
| `@2xl:` | 672px     | —             |

### When to use which

| Situation                                    | Use                            |
| :------------------------------------------- | :----------------------------- |
| **Reusable component** (Card, Widget, Panel) | `@container` + `@sm:`          |
| **Page-level layout** (sidebar + main)       | `sm:`, `md:`, `lg:` (viewport) |
| **Component inside a grid/flex parent**      | `@container` + `@sm:`          |

```tsx
// ❌ WRONG: Media query in a reusable component
<Card className="flex-col sm:flex-row" />  // depends on viewport

// ✅ CORRECT: Container query in a reusable component
<div className="@container">
  <Card className="flex-col @sm:flex-row" />  // depends on parent size
</div>
```

## Verification Checklist

Before finalizing any Tailwind CSS code, verify:

1. Are there any `[` containing `--`? (e.g. `-[--`)
   - If yes, check if it is a `text-[length:--` case.
   - If not `length:`, it is likely an **ERROR**. Change `[]` to `()`.
2. Are you using a CSS variable? Ensure it is wrapped in `()`, e.g., `-(--var)`.
3. Is the code inside a **reusable component**? Use `@container` + `@sm:`
   instead of viewport `sm:`.
