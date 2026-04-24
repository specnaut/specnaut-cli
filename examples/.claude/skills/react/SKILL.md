---
name: react
description: Guidelines for creating React components using ShadCN UI primitives, Tailwind CSS, and the project's design token variables for maximum customizability.
---

# React Component Creation Skill

This skill defines **mandatory rules** for creating any new React component in
the Miximodel project. Every component must leverage ShadCN UI primitives,
Tailwind CSS utility classes, and the project's CSS variable design tokens.

## 🚨 CRITICAL RULES

### 1. Always use ShadCN UI primitives as the foundation

Before creating any component from scratch, **check if a ShadCN UI primitive
already exists** in `inertia/components/ui/`. If it does, compose on top of it
rather than rebuilding from zero.

Currently installed primitives:

| Component      | Path                              |
| :------------- | :-------------------------------- |
| Accordion      | `@/components/ui/accordion`       |
| AlertDialog    | `@/components/ui/alert-dialog`    |
| Alert          | `@/components/ui/alert`           |
| AspectRatio    | `@/components/ui/aspect-ratio`    |
| Avatar         | `@/components/ui/avatar`          |
| Badge          | `@/components/ui/badge`           |
| Breadcrumb     | `@/components/ui/breadcrumb`      |
| Button         | `@/components/ui/button`          |
| Calendar       | `@/components/ui/calendar`        |
| Card           | `@/components/ui/card`            |
| Carousel       | `@/components/ui/carousel`        |
| Chart          | `@/components/ui/chart`           |
| Checkbox       | `@/components/ui/checkbox`        |
| Combobox       | `@/components/ui/combobox`        |
| Command        | `@/components/ui/command`         |
| ContextMenu    | `@/components/ui/context-menu`    |
| Dialog         | `@/components/ui/dialog`          |
| Drawer         | `@/components/ui/drawer`          |
| DropdownMenu   | `@/components/ui/dropdown-menu`   |
| Empty          | `@/components/ui/empty`           |
| Field          | `@/components/ui/field`           |
| HoverCard      | `@/components/ui/hover-card`      |
| InputGroup     | `@/components/ui/input-group`     |
| InputOtp       | `@/components/ui/input-otp`       |
| Input          | `@/components/ui/input`           |
| Item           | `@/components/ui/item`            |
| Kbd            | `@/components/ui/kbd`             |
| Label          | `@/components/ui/label`           |
| Menubar        | `@/components/ui/menubar`         |
| NativeSelect   | `@/components/ui/native-select`   |
| NavigationMenu | `@/components/ui/navigation-menu` |
| Pagination     | `@/components/ui/pagination`      |
| Popover        | `@/components/ui/popover`         |
| Progress       | `@/components/ui/progress`        |
| RadioGroup     | `@/components/ui/radio-group`     |
| ScrollArea     | `@/components/ui/scroll-area`     |
| Select         | `@/components/ui/select`          |
| Separator      | `@/components/ui/separator`       |
| Sheet          | `@/components/ui/sheet`           |
| Sidebar        | `@/components/ui/sidebar`         |
| Skeleton       | `@/components/ui/skeleton`        |
| Slider         | `@/components/ui/slider`          |
| Sonner         | `@/components/ui/sonner`          |
| Spinner        | `@/components/ui/spinner`         |
| Switch         | `@/components/ui/switch`          |
| Table          | `@/components/ui/table`           |
| Tabs           | `@/components/ui/tabs`            |
| Textarea       | `@/components/ui/textarea`        |
| ToggleGroup    | `@/components/ui/toggle-group`    |
| Toggle         | `@/components/ui/toggle`          |
| Tooltip        | `@/components/ui/tooltip`         |

If a needed primitive is **not** installed, use the helper script to install it
and automatically update the table above:

```bash
bash .claude/skills/react/scripts/add_component.sh <component-name>

# Multiple components at once:
bash .claude/skills/react/scripts/add_component.sh toast drawer collapsible
```

Or install manually (but the table won't be auto-updated):

```bash
npx shadcn@latest add <component-name>
```

### 2. Always use Tailwind CSS — never write custom CSS

- Use **Tailwind utility classes** for all styling.
- **Never** create custom CSS classes or stylesheets for components.
- Use the `cn()` helper from `@/lib/utils` for conditional/merged class names.

```tsx
import { cn } from '@/lib/utils'

function MyComponent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-4 rounded-lg p-4', className)} {...props} />
}
```

### 3. Always use design token CSS variables — never hardcode colors or sizes

The project defines a complete design token system in `inertia/css/app.css`.
Components **must** reference these tokens via their Tailwind aliases so they
automatically adapt to light/dark mode and future theme changes.

#### Color Tokens (use via Tailwind classes)

| Token                    | Tailwind class example               | Purpose                    |
| :----------------------- | :----------------------------------- | :------------------------- |
| `--background`           | `bg-background`                      | Page background            |
| `--foreground`           | `text-foreground`                    | Primary text               |
| `--card`                 | `bg-card`                            | Card surfaces              |
| `--card-foreground`      | `text-card-foreground`               | Card text                  |
| `--popover`              | `bg-popover`                         | Popover/dropdown bg        |
| `--popover-foreground`   | `text-popover-foreground`            | Popover text               |
| `--primary`              | `bg-primary`, `text-primary`         | Primary actions/accents    |
| `--primary-foreground`   | `text-primary-foreground`            | Text on primary surfaces   |
| `--secondary`            | `bg-secondary`                       | Secondary surfaces         |
| `--secondary-foreground` | `text-secondary-foreground`          | Text on secondary surfaces |
| `--muted`                | `bg-muted`                           | Muted/subtle backgrounds   |
| `--muted-foreground`     | `text-muted-foreground`              | Secondary/helper text      |
| `--accent`               | `bg-accent`                          | Accent/hover surfaces      |
| `--accent-foreground`    | `text-accent-foreground`             | Text on accent surfaces    |
| `--destructive`          | `bg-destructive`, `text-destructive` | Danger/error states        |
| `--border`               | `border-border`                      | Borders                    |
| `--input`                | `border-input`                       | Input borders              |
| `--ring`                 | `ring-ring`                          | Focus rings                |

#### Radius Tokens

| Token          | Tailwind class | Value                             |
| :------------- | :------------- | :-------------------------------- |
| `--radius-sm`  | `rounded-sm`   | `calc(var(--radius) - 4px)`       |
| `--radius-md`  | `rounded-md`   | `calc(var(--radius) - 2px)`       |
| `--radius-lg`  | `rounded-lg`   | `var(--radius)` (base = 0.625rem) |
| `--radius-xl`  | `rounded-xl`   | `calc(var(--radius) + 4px)`       |
| `--radius-2xl` | `rounded-2xl`  | `calc(var(--radius) + 8px)`       |

#### ❌ What NOT to do

```tsx
// WRONG: hardcoded colors
<div className="bg-[#f5f5f5] text-[#333] border-[#ddd]">

// WRONG: hardcoded Tailwind palette colors
<div className="bg-gray-100 text-gray-800 border-gray-300">

// WRONG: hardcoded border-radius
<div className="rounded-[8px]">
```

#### ✅ What to do

```tsx
// CORRECT: design token variables via Tailwind
<div className="bg-muted text-foreground border-border rounded-lg">
```

### 4. Feature-Driven Architecture (Folder Structure)

**NEVER** dump all components into `inertia/components/`. You **MUST** organize
code by business domain following a **Feature-Driven Architecture**.

- **`inertia/features/<domain>/components/`**: Place all domain-specific or
  feature-specific components here (e.g., `inertia/features/chat/components/`,
  `inertia/features/bookings/components/`).
- **`inertia/components/`**: Strictly reserved for **global, highly reusable, or
  generic UI components** (e.g., layouts, global navigation, generic empty
  states).
- **`inertia/components/ui/`**: ShadCN primitives only.

```
inertia/
├── components/          ← Global, domain-agnostic generic components
│   ├── ui/              ← ShadCN primitives (do NOT manually edit)
│   └── navbar.tsx
├── features/            ← Domain-specific modules
│   ├── bookings/
│   │   ├── components/  ← Booking-specific components (e.g. BookingCard)
│   │   └── hooks/
│   └── chat/
│       ├── components/  ← Chat-specific components
│       └── utils/
└── pages/               ← Smart components / routes
```

### 5. Strict Separation of Smart vs. Dumb Components

- **Dumb Components (UI Components)**: **MUST NOT** make network calls, trigger
  side effects for data fetching, or import Inertia hooks like `usePage` or
  `router`. They receive all their data and behavior callbacks exclusively via
  `props`.
- **Smart Components (Pages)**: Residing in `inertia/pages/`, these components
  are responsible for consuming data from Inertia page props, directing routing
  logic, and passing the required data down to Dumb Components.

### 6. State and Side Effects Management (Clean Code)

- **NEVER** use Redux or any major global state management libraries unless
  explicitly required.
- Favor `useState` for simple local component state.
- Extract complex component behavior and business logic into **Custom Hooks**.
- **PROHIBITED**: Isolated `useEffect` blocks inside UI components that act as
  data fetchers on mount. Data must be prepared server-side by AdonisJS, passed
  through Inertia page props, or handled securely by a top-level Smart
  Component.

### 7. Global State Management & Zustand

- **NO duplication of Server State.** Zustand is strictly for client UI state (complex drafts, modals, live notifications). Database data must remain handled by Adonis/Inertia via page props.
- **Stores must be sliced by Feature.** Stores follow the feature-driven architecture. Example: `inertia/features/chat/store/useChatStore.ts`.
- **Mandatory `persist` middleware** when persisting local structural user preferences (e.g., local storage for active tabs, bookmarks).
- **Adonis Transmit (SSE) listeners** must interact directly with Zustand actions to trigger reactive UI updates without prop-drilling.

### 8. Form Standardization (Inertia + VineJS)

- **MUST EXCLUSIVELY** use Inertia's `useForm` hook for managing form state and
  submissions.
- **NO Client-Side Validation Libraries** (e.g., Zod, Yup). Do not recreate
  complex validation schemas on the frontend.
- Rely solely on **VineJS** validation executed natively on the AdonisJS server.
- Map the parsed server validation errors seamlessly back to the UI utilizing
  Inertia's form `errors` object, rendered through standard `FieldError`
  components.

### 9. Component authoring pattern

Every component **must** follow this pattern:

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

// 1. Import ShadCN primitives you need
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// 2. Define props — always extend with className for customizability
interface ProfileCardProps extends React.ComponentProps<'div'> {
  name: string
  role: string
  avatarUrl?: string
}

// 3. Export the component — always merge className with cn()
export function ProfileCard({ name, role, avatarUrl, className, ...props }: ProfileCardProps) {
  return (
    <Card className={cn('w-full max-w-sm', className)} {...props}>
      <CardHeader>
        <CardTitle className="text-foreground">{name}</CardTitle>
        <p className="text-sm text-muted-foreground">{role}</p>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full">
          View Profile
        </Button>
      </CardContent>
    </Card>
  )
}
```

### 10. Icons

Use **Hugeicons** from `@hugeicons/core-free-icons` with the `@hugeicons/react`
renderer:

```tsx
import { HugeiconsIcon } from '@hugeicons/react'
import { SearchIcon } from '@hugeicons/core-free-icons'
;<HugeiconsIcon icon={SearchIcon} size={16} strokeWidth={2} />
```

### 11. Dark mode support

- Dark mode is toggled via the `.dark` class on a parent element.
- The `@custom-variant dark` directive is already configured.
- All design tokens automatically switch values in dark mode.
- Use `dark:` variant **only** when you need to override beyond what the tokens
  provide.

```tsx
// Usually NOT needed — tokens handle it:
<div className="bg-background text-foreground">

// Only when you need an explicit dark override:
<div className="shadow-md dark:shadow-none">
```

### 12. Responsive design — prefer container queries

- **For components**, use container queries (`@container` + `@sm:`, `@md:`) so
  they adapt to their **parent's size**, not the viewport.
- **For page layouts**, use viewport prefixes (`sm:`, `md:`, `lg:`).
- Design **mobile-first**: base classes for smallest, then add prefixes for
  larger sizes.

```tsx
// ✅ CORRECT: Component uses container queries
<div className="@container">
  <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 gap-4">
    ...
  </div>
</div>

// ✅ Page layout can use viewport queries
<main className="px-4 md:px-8 lg:px-12">
  ...
</main>
```

### 13. Base UI Button + Link composition

The `Button` component is built on `@base-ui/react/button`, which **does NOT
support `asChild`** (that's a Radix UI concept). Instead, use the `render` prop
to render a non-button element (like an Inertia `<Link>`).

**⚠️ IMPORTANT:** When using `render`, the `Button` component automatically sets
`nativeButton={false}` to prevent the Base UI warning about non-`<button>`
semantics. This is handled in `inertia/components/ui/button.tsx`.

#### ✅ Correct patterns

```tsx
import { Link } from '@adonisjs/inertia/react'
import { Button } from '@/components/ui/button' // Pattern 1: Button rendering a Link (recommended)
;<Button variant="ghost" size="sm" render={<Link route="home" />}>
  Go Home
</Button>

// Pattern 2: Using buttonVariants + cn for full control
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
;<Link route="home" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
  Go Home
</Link>
```

#### ❌ What NOT to do

```tsx
// WRONG: asChild does NOT exist on Base UI Button
<Button asChild>
  <Link route="home">Go Home</Link>
</Button>

// WRONG: Wrapping Button around Link without render prop
<Button>
  <Link route="home">Go Home</Link>
</Button>
```

### 14. Accessibility

- Use semantic HTML elements (`button`, `nav`, `main`, `section`, `article`).
- Add `aria-` attributes when the semantics are not obvious.
- Ensure interactive elements have visible focus states (already handled by
  ShadCN primitives via `focus-visible:ring-ring`).
- Use the `Field`, `FieldLabel`, and `FieldError` components for all form
  fields.

### 15. TypeScript type safety

- **Never use `any`** — always define explicit types for props, state, and event
  handlers.
- **Extend native HTML element props** using `React.ComponentProps<'element'>`
  for maximum composability.
- **Use discriminated unions** for components with variant-dependent props.
- **Always type event handler callbacks** in props.

#### Props typing patterns

```tsx
// ✅ CORRECT: Extend native element props
interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'destructive'
  isLoading?: boolean
}

// ✅ CORRECT: Discriminated union for variant-dependent props
type NotificationProps =
  | { variant: 'success'; message: string }
  | { variant: 'error'; message: string; retryAction: () => void }

// ✅ CORRECT: Typed event handlers
interface SearchInputProps extends React.ComponentProps<'input'> {
  onSearch: (query: string) => void
  onClear?: () => void
}
```

#### ❌ What NOT to do

```tsx
// WRONG: Using `any`
function UserCard({ user }: { user: any }) { ... }

// WRONG: Untyped event handlers
interface FormProps {
  onSubmit: (data: any) => void  // ❌ What is `data`?
}

// WRONG: Overly loose types
interface CardProps {
  config: object  // ❌ Use a specific interface
}
```

#### ✅ What to do

```tsx
// CORRECT: Explicit types
interface User {
  id: number
  name: string
  email: string
}

function UserCard({ user }: { user: User }) { ... }

// CORRECT: Typed event handlers
interface FormProps {
  onSubmit: (data: { email: string; password: string }) => void
}

// CORRECT: Specific config type
interface CardConfig {
  title: string
  showAvatar: boolean
  maxWidth?: number
}

interface CardProps {
  config: CardConfig
}
```

## Checklist before submitting a new component

Before finalizing any new component, verify:

- [ ] Built on top of ShadCN UI primitives when applicable
- [ ] Styled **only** with Tailwind utility classes (no custom CSS)
- [ ] Uses design token colors (`bg-primary`, `text-muted-foreground`, etc.) —
      no hardcoded colors
- [ ] Uses design token radii (`rounded-md`, `rounded-lg`, etc.) — no hardcoded
      `rounded-[Xpx]`
- [ ] Accepts `className` prop and merges it with `cn()`
- [ ] Spreads remaining `...props` for composability
- [ ] Works in both light and dark mode
- [ ] Uses `@hugeicons` for icons (not Lucide, Heroicons, etc.)
- [ ] Is responsive (mobile-first with breakpoint prefixes)
- [ ] Follows the Tailwind V4 CSS variable syntax: `()` not `[]` for variables
      (see the `tailwind-v4-expert` skill)
- [ ] **No `any` types** — all props, state, and callbacks are explicitly typed
- [ ] Props interface extends `React.ComponentProps<'element'>` when wrapping an
      HTML element
- [ ] Event handler props are fully typed (no `any` parameters)
- [ ] Discriminated unions used for variant-dependent prop shapes
- [ ] Button-as-Link uses `render` prop (not `asChild`) — never nest `<Link>`
      inside `<Button>` without `render`
- [ ] **Feature-Driven Architecture**: Domain-specific components are placed in
      `inertia/features/<domain>/components/` (only generic components go in
      `inertia/components/`)
- [ ] **Smart/Dumb Separation**: UI components do not use Inertia hooks
      (`usePage`, `router`) or fetch data directly
- [ ] **State & Effects**: No isolated `useEffect` data fetching on mount inside
      Dumb Components; handles complex logic via custom hooks
- [ ] **Forms**: Strict standard using Inertia's `useForm` and matching
      server-side errors handled via `FieldError` (No Zod or Yup)
