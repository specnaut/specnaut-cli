# Architecture

## Request Flow

```
Request → Controller → Service → Repository → Database
              ↑             ↑           ↑
         HTTP concerns   Business    Data access
         (validate,      logic       (Lucid queries)
          respond)
```

## What Goes Where

| Layer           | Location            | Responsibility                                | Example                             |
| :-------------- | :------------------ | :-------------------------------------------- | :---------------------------------- |
| **Controller**  | `app/controllers/`  | Validate input, call service, return response | Parse request, render Inertia page  |
| **Validator**   | `app/validators/`   | Input validation schemas (VineJS)             | Email format, required fields       |
| **Service**     | `app/services/`     | Business logic, orchestration                 | Create user + send welcome email    |
| **Repository**  | `app/repositories/` | Database queries (Lucid ORM)                  | Find user by email, paginate models |
| **Transformer** | `app/transformers/` | Shape data for the frontend                   | Pick specific user fields           |
| **Model**       | `app/models/`       | Schema extension, relationships, getters      | User extends UserSchema             |
| **Exception**   | `app/exceptions/`   | Domain-specific errors                        | UnauthorizedException               |

## File Structure

```
app/
├── controllers/          ← Thin HTTP handlers
│   └── user_controller.ts
├── services/             ← Business logic
│   └── user_service.ts
├── repositories/         ← Database access
│   └── user_repository.ts
├── validators/           ← Input validation (VineJS)
│   └── user.ts
├── transformers/         ← Data shaping for frontend
│   └── user_transformer.ts
├── models/               ← Lucid ORM models
│   └── user.ts
└── exceptions/           ← Custom error handlers
    └── handler.ts
```

## Dependency Injection Rules

### Constructor injection (for services and repositories)

Use `@inject()` at the **class level** when the class always needs its
dependencies:

```typescript
import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'

@inject()
export default class UserService {
  constructor(private userRepository: UserRepository) {}
}
```

### Method injection (for controllers)

Use `@inject()` at the **method level** on controllers. The first parameter is
always `HttpContext`, and injected dependencies follow:

```typescript
import { inject } from '@adonisjs/core'
import UserService from '#services/user_service'

export default class UserController {
  @inject()
  async store({ request, response }: HttpContext, userService: UserService) {
    // ...
  }
}
```

### ❌ What NOT to Do

```typescript
// WRONG: Instantiating services manually
export default class UserController {
  async store({ request }: HttpContext) {
    const service = new UserService() // ❌ No manual instantiation
  }
}

// WRONG: Database queries directly in the controller
export default class UserController {
  async store({ request }: HttpContext) {
    const user = await User.create({ ... }) // ❌ No Lucid in controllers
  }
}

// WRONG: Business logic in the controller
export default class UserController {
  async store({ request }: HttpContext) {
    const emailPrefix = payload.email.split('@')[0] // ❌ Belongs in a service
  }
}
```
