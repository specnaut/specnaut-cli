# Controllers

📖 **Documentation:**
[`controllers.md`](https://docs.adonisjs.com/guides/basics/controllers.md)

## Quick Start

```bash
bash .claude/skills/adonisjs-v7/scripts/create_controller.sh <Name>
```

This creates the controller, service, repository, and unit test file in one
command.

## Controller Structure

Controllers handle **only HTTP concerns**: validate input, call the service, and
return a response. Inject services via **method injection** with `@inject()`.

```typescript
// app/controllers/user_controller.ts
import { inject } from '@adonisjs/core'
import { signupValidator } from '#validators/user'
import UserService from '#services/user_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class UserController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/signup', {})
  }

  @inject()
  async store({ request, response, auth }: HttpContext, userService: UserService) {
    const payload = await request.validateUsing(signupValidator)
    const user = await userService.register(payload)

    await auth.use('web').login(user)
    return response.redirect().toRoute('home')
  }

  @inject()
  async show({ params, inertia }: HttpContext, userService: UserService) {
    const user = await userService.getProfile(params.id)
    return inertia.render('users/show', { user })
  }
}
```

## Route Registration

```typescript
// start/routes.ts
import { controllers } from '#generated/controllers'

router.get('signup', [controllers.User, 'create'])
router.post('signup', [controllers.User, 'store'])
router.get('users/:id', [controllers.User, 'show'])
```

## Checklist

- [ ] Controller is **thin** — only validates, delegates, and responds
- [ ] **No Lucid model** calls directly in the controller
- [ ] **No business logic** in the controller (name parsing, computations, etc.)
- [ ] All business logic lives in a **service** (`app/services/`)
- [ ] All database access lives in a **repository** (`app/repositories/`)
- [ ] Dependencies are injected via `@inject()` — no manual `new` instantiation
- [ ] Input is validated via a **VineJS validator** (`app/validators/`)
- [ ] Controller methods use `HttpContext` destructuring
      (`{ request, response, inertia }`)
- [ ] Uses subpath imports (`#services/...`, `#repositories/...`)
- [ ] Code follows **DRY** — no duplicated logic across controllers
- [ ] Code follows **KISS** — each function does one thing
