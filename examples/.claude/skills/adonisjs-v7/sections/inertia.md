# Inertia Pages

📖 **Documentation:**
[`inertia.md`](https://docs.adonisjs.com/guides/frontend/inertia.md)

## End-to-End Flow

```
Route (start/routes.ts)
  → Controller (app/controllers/)
    → inertia.render('path/page', { props })
      → React Page (inertia/pages/path/page.tsx)
```

## Step-by-Step

### 1. Define the route

```typescript
// start/routes.ts
import router from '@adonisjs/core/services/router'

const ProjectsController = () => import('#controllers/projects_controller')

router.get('projects', [ProjectsController, 'index']).as('projects.index')
router.get('projects/:id', [ProjectsController, 'show']).as('projects.show')
router.post('projects', [ProjectsController, 'store']).as('projects.store')
```

### 2. Create the controller

The controller renders the Inertia page with typed props:

```typescript
// app/controllers/projects_controller.ts
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ProjectService from '#services/project_service'

export default class ProjectsController {
  @inject()
  async index({ inertia }: HttpContext, projectService: ProjectService) {
    const projects = await projectService.listAll()
    return inertia.render('projects/index', { projects })
  }

  @inject()
  async show({ inertia, params }: HttpContext, projectService: ProjectService) {
    const project = await projectService.findByIdOrFail(params.id)
    return inertia.render('projects/show', { project })
  }
}
```

### 3. Create the React page

```tsx
// inertia/pages/projects/index.tsx
import { Link } from '@adonisjs/inertia/react'

interface Project {
  id: number
  name: string
  description: string | null
}

interface Props {
  projects: Project[]
}

export default function ProjectsIndex({ projects }: Props) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
      <ul className="space-y-4">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              route="projects.show"
              routeParams={{ id: project.id }}
              className="font-medium text-primary hover:underline"
            >
              {project.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

## Forms

Use `Form` from `@adonisjs/inertia/react` — not native `<form>`:

```tsx
import { Form } from '@adonisjs/inertia/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'

export default function ProjectCreate() {
  return (
    <Form route="projects.store">
      {({ errors }) => (
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="name">Project name</FieldLabel>
            <Input
              name="name"
              id="name"
              placeholder="My project"
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>

          <Button type="submit">Create</Button>
        </FieldGroup>
      )}
    </Form>
  )
}
```

## Key Rules

### Navigation

- **Always use `Link`** from `@adonisjs/inertia/react` — never `<a href>` for
  internal links
- Use `route` prop with route name — never hardcode paths:

```tsx
// ✅ CORRECT
<Link route="projects.show" routeParams={{ id: 1 }}>View</Link>

// ❌ WRONG
<a href="/projects/1">View</a>
```

### Props typing

- **Always define a `Props` interface** for every page component
- Type props explicitly — never use `any`

```tsx
interface Props {
  user: {
    id: number
    email: string
    fullName: string
  }
  isOwner: boolean
}

export default function UserProfile({ user, isOwner }: Props) { ... }
```

### File naming

Pages mirror routes inside `inertia/pages/`:

```
Route: /projects           → inertia/pages/projects/index.tsx
Route: /projects/:id       → inertia/pages/projects/show.tsx
Route: /projects/create     → inertia/pages/projects/create.tsx
Route: /auth/login          → inertia/pages/auth/login.tsx
```

## Checklist

- [ ] Route defined in `start/routes.ts` with `.as()` name
- [ ] Controller renders via `inertia.render('path/page', { props })`
- [ ] React page in `inertia/pages/` matching render path
- [ ] Props interface defined — no `any` types
- [ ] Uses `Link` from `@adonisjs/inertia/react` for navigation
- [ ] Uses `Form` from `@adonisjs/inertia/react` for forms
- [ ] Form errors handled via the render callback `{({ errors }) => ...}`
- [ ] Uses ShadCN UI components and design tokens (see component-creation skill)

## Troubleshooting

### Vite `504 Outdated Optimize Dep` errors

**Symptom:** The browser console shows `504 (Outdated Optimize Dep)` and
`Failed to fetch dynamically imported module` errors, especially when navigating
between pages. Requires restarting `npm run dev` to fix.

**Root cause:** Inertia resolves pages via `import.meta.glob('./pages/**/*.tsx')`
which generates **lazy dynamic imports**. By default, Vite only scans static
entry points at startup (`app.tsx`). It doesn't crawl into these dynamically
imported page files.

When you navigate to a page for the first time, Vite discovers new
`node_modules` dependencies used by that page (e.g. a UI library sub-path). This
triggers a mid-session **re-optimization** of the deps bundle, which invalidates
all already-loaded modules → `504 Outdated`.

**Fix:** Tell Vite to scan all page and component files at startup via
`optimizeDeps.entries`:

```typescript
// vite.config.ts
export default defineConfig({
  // ...
  optimizeDeps: {
    // Force Vite to crawl all pages + components at startup so every
    // dependency is discovered before the first request is served.
    entries: ['inertia/app.tsx', 'inertia/pages/**/*.tsx', 'inertia/components/**/*.tsx'],
  },
})
```

This makes Vite scan every page/component at boot, discovering all their
dependencies upfront. No more mid-session re-optimization.

> **Note:** After adding `entries`, you do **not** need a manual `include` list.
> Vite will automatically find every `node_modules` dependency by crawling the
> listed files. You only need `include` for packages imported in unusual ways
> (e.g. conditional `import()` expressions).

After changing `optimizeDeps`, always clear the cache and restart:

```bash
rm -rf node_modules/.vite && npm run dev
```
