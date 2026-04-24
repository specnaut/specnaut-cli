# Error Handling

📖 **Documentation:**
[`exception-handling.md`](https://docs.adonisjs.com/guides/basics/exception-handling.md)

## Architecture

```
Error thrown
  → Global Exception Handler (app/exceptions/handler.ts)
    → Status pages (Inertia error pages)
    → Error reporting (logs)
```

## Global Exception Handler

Located at `app/exceptions/handler.ts`:

```typescript
import { ExceptionHandler, HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  protected renderStatusPages = app.inProduction

  protected statusPages: Record<string, string> = {
    '404': 'errors/not_found',
    '500..599': 'errors/server_error',
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
```

## Status Pages (Inertia)

Error pages are React components in `inertia/pages/errors/`:

```tsx
// inertia/pages/errors/not_found.tsx
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold text-foreground">404</h1>
      <p className="text-lg text-muted-foreground">Page not found</p>
    </div>
  )
}
```

```tsx
// inertia/pages/errors/server_error.tsx
export default function ServerError() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold text-foreground">500</h1>
      <p className="text-lg text-muted-foreground">Something went wrong</p>
    </div>
  )
}
```

## Custom Exceptions

Create domain-specific exceptions:

```bash
node ace make:exception unauthorized
```

```typescript
// app/exceptions/unauthorized_exception.ts
import { Exception } from '@adonisjs/core/exceptions'

export default class UnauthorizedException extends Exception {
  static status = 403
  static code = 'E_UNAUTHORIZED'
  static message = 'You are not authorized to perform this action'
}
```

Usage in a service:

```typescript
import UnauthorizedException from '#exceptions/unauthorized_exception'

export default class ProjectService {
  async delete(projectId: number, userId: number) {
    const project = await this.projectRepository.findByIdOrFail(projectId)

    if (project.ownerId !== userId) {
      throw new UnauthorizedException()
    }

    await this.projectRepository.delete(project)
  }
}
```

## When to Use Custom Exceptions

| Situation                | Pattern                                                              |
| :----------------------- | :------------------------------------------------------------------- |
| Not found                | Use Lucid's `.findOrFail()` — throws `E_ROW_NOT_FOUND` automatically |
| Validation error         | VineJS throws automatically — no custom exception needed             |
| Authorization failure    | Custom `UnauthorizedException`                                       |
| Business rule violation  | Custom exception (e.g., `InsufficientCreditsException`)              |
| External service failure | Custom exception with context                                        |

## Rules

1. **Let the framework handle common errors** — validation, 404, etc. are
   handled automatically
2. **Custom exceptions** only for domain-specific business errors
3. **Status pages** must exist as Inertia pages in `inertia/pages/errors/`
4. **Never swallow errors silently** — always log or re-throw
5. **Services throw, controllers don't catch** — let the exception handler deal
   with it

## Checklist

- [ ] `app/exceptions/handler.ts` configured with status pages
- [ ] Inertia error pages exist for 404 and 500
- [ ] Custom exceptions use `Exception` base class with `status` and `code`
- [ ] Business logic errors use custom exceptions (not generic `Error`)
- [ ] Services throw exceptions — controllers let them propagate
