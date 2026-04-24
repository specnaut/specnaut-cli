# Services

📖 **Documentation:**
[`dependency-injection.md`](https://docs.adonisjs.com/guides/concepts/dependency-injection.md)

## Quick Start

```bash
bash .claude/skills/adonisjs-v7/scripts/create_service.sh <ServiceName>
```

This creates both the service file and its unit test file.

## Core Principles

| Principle                  | Rule                                                             |
| :------------------------- | :--------------------------------------------------------------- |
| **Testable by design**     | Every public method must have at least one unit test             |
| **Dependency Injection**   | Use `@inject()` with constructor injection for all dependencies  |
| **Single Responsibility**  | Each service handles one domain (users, auth, notifications…)    |
| **Pure business logic**    | No HTTP concerns (no `request`, `response`, `inertia`)           |
| **Repository abstraction** | Database calls go through repositories, making them mockable     |
| **Type safety**            | No `any` — use explicit types, DTOs, and return types everywhere |

## Service Structure

### Basic service template

```typescript
// app/services/user_service.ts
import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'

@inject()
export default class UserService {
  constructor(private userRepository: UserRepository) {}

  async findById(id: number) {
    return this.userRepository.findById(id)
  }

  async register(data: { email: string; password: string; fullName?: string | null }) {
    const [firstName, ...rest] = (data.fullName ?? '').split(' ')
    const lastName = rest.join(' ')

    return this.userRepository.create({
      email: data.email,
      password: data.password,
      firstName: firstName || '',
      lastName: lastName || '',
    })
  }
}
```

## Rules

1. **Always use `@inject()` at the class level** for dependency injection:

```typescript
import { inject } from '@adonisjs/core'
import UserRepository from '#repositories/user_repository'
import EmailService from '#services/email_service'

@inject()
export default class UserService {
  constructor(
    private userRepository: UserRepository,
    private emailService: EmailService
  ) {}
}
```

2. **Never import `HttpContext`** — services must not depend on HTTP:

```typescript
// ❌ WRONG
import type { HttpContext } from '@adonisjs/core/http'

export default class UserService {
  async doSomething(ctx: HttpContext) {} // Services don't know about HTTP
}

// ✅ CORRECT
export default class UserService {
  async doSomething(userId: number) {} // Accept plain data
}
```

3. **Keep methods focused** — one method = one action:

```typescript
// ❌ WRONG: Too many things in one method
async registerAndSendEmailAndLogActivity(data: RegisterData) { ... }

// ✅ CORRECT: Compose small methods
async register(data: RegisterData) {
  const user = await this.userRepository.create(data)
  await this.emailService.sendWelcome(user)
  await this.activityService.log('register', user.id)
  return user
}
```

4. **Return values, don't throw for expected cases** — use return types:

```typescript
// ✅ Return null for "not found" scenarios
async findByEmail(email: string) {
  return this.userRepository.findByEmail(email) // returns User | null
}

// ✅ Throw for truly exceptional cases
async findByIdOrFail(id: number) {
  const user = await this.userRepository.findById(id)
  if (!user) throw new Error(`User ${id} not found`)
  return user
}
```

5. **TypeScript type safety** — never use `any`, always type inputs and outputs:

```typescript
// ❌ WRONG: Untyped method signatures
export default class UserService {
  async register(data: any) { ... }         // What is `data`?
  async search(filters: object) { ... }     // Too loose
}

// ✅ CORRECT: Define DTOs/interfaces for all inputs and outputs
interface RegisterData {
  email: string
  password: string
  fullName?: string | null
}

interface UserResult {
  id: number
  email: string
  firstName: string
  lastName: string
}

export default class UserService {
  async register(data: RegisterData): Promise<UserResult> { ... }
  async findById(id: number): Promise<UserResult | null> { ... }
}
```

### Type safety rules for services

- **Define interfaces/types** for all method parameters (DTOs)
- **Annotate return types** on all public methods — don't rely on inference
- **Never use `any`** — use `unknown` if the type is truly unknown, then narrow
  it
- **Use `Partial<T>`** and `Pick<T, K>` for update operations instead of custom
  types
- **Type repository interfaces** so mocks in tests follow the same contract

```typescript
// ✅ Typed repository interface — shared between real and mock implementations
interface IUserRepository {
  findById(id: number): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  create(data: CreateUserData): Promise<User>
  update(user: User, data: Partial<User>): Promise<User>
}

@inject()
export default class UserService {
  constructor(private userRepository: IUserRepository) {}
}
```

## Unit Tests

### Test file location

Tests mirror the service structure inside `tests/unit/services/`:

```
app/services/user_service.ts       → tests/unit/services/user_service.spec.ts
app/services/email_service.ts      → tests/unit/services/email_service.spec.ts
app/services/payment_service.ts    → tests/unit/services/payment_service.spec.ts
```

### Test template

```typescript
// tests/unit/services/user_service.spec.ts
import { test } from '@japa/runner'
import UserService from '#services/user_service'

test.group('UserService', () => {
  test('register creates a user with parsed name', async ({ assert }) => {
    // Arrange: create a mock repository
    const mockRepository = {
      create: async (data: any) => ({ id: 1, ...data }),
      findById: async () => null,
      findByEmail: async () => null,
    }

    // Act: instantiate the service with the mock
    const service = new UserService(mockRepository as any)
    const user = await service.register({
      email: 'john@example.com',
      password: 'password123',
      fullName: 'John Doe',
    })

    // Assert
    assert.equal(user.email, 'john@example.com')
    assert.equal(user.firstName, 'John')
    assert.equal(user.lastName, 'Doe')
  })

  test('register handles null fullName', async ({ assert }) => {
    const mockRepository = {
      create: async (data: any) => ({ id: 1, ...data }),
    }

    const service = new UserService(mockRepository as any)
    const user = await service.register({
      email: 'john@example.com',
      password: 'password123',
      fullName: null,
    })

    assert.equal(user.firstName, '')
    assert.equal(user.lastName, '')
  })
})
```

### Testing patterns

#### Pattern 1: Mock repositories via constructor

Since services use `@inject()` constructor injection, you can bypass the IoC
container and pass mock repositories directly:

```typescript
const mockRepo = {
  findById: async (id: number) => ({ id, email: 'test@test.com' }),
  create: async (data: any) => ({ id: 1, ...data }),
}

const service = new UserService(mockRepo as any)
```

#### Pattern 2: Spy on method calls

Use simple spies to verify that the service calls the right methods:

```typescript
test('register calls repository.create', async ({ assert }) => {
  let createCalled = false
  let createArgs: any = null

  const mockRepo = {
    create: async (data: any) => {
      createCalled = true
      createArgs = data
      return { id: 1, ...data }
    },
  }

  const service = new UserService(mockRepo as any)
  await service.register({
    email: 'test@test.com',
    password: 'pass',
    fullName: 'Test',
  })

  assert.isTrue(createCalled)
  assert.equal(createArgs.email, 'test@test.com')
})
```

#### Pattern 3: Test error cases

```typescript
test('findByIdOrFail throws when user not found', async ({ assert }) => {
  const mockRepo = {
    findById: async () => null,
  }

  const service = new UserService(mockRepo as any)

  await assert.rejects(() => service.findByIdOrFail(999), 'User 999 not found')
})
```

#### Pattern 4: Test with multiple dependencies

```typescript
test('register sends welcome email', async ({ assert }) => {
  let emailSent = false

  const mockUserRepo = {
    create: async (data: any) => ({ id: 1, ...data }),
  }

  const mockEmailService = {
    sendWelcome: async () => {
      emailSent = true
    },
  }

  const service = new UserService(mockUserRepo as any, mockEmailService as any)
  await service.register({ email: 'test@test.com', password: 'pass' })

  assert.isTrue(emailSent)
})
```

## Running Tests

```bash
# Run all unit tests
node ace test --suite unit

# Run a specific test file
node ace test --suite unit --files "services/user_service"

# Run tests in watch mode
node ace test --suite unit --watch
```

## Checklist

- [ ] Service created in `app/services/` (via `node ace make:service` or script)
- [ ] Uses `@inject()` decorator for dependency injection
- [ ] Constructor injection for all dependencies (repositories, other services)
- [ ] **No `HttpContext`** import or usage — services are HTTP-agnostic
- [ ] All database access delegated to repositories — no direct Lucid calls
- [ ] Each public method has a clear return type
- [ ] **Unit test file** exists at `tests/unit/services/<name>.spec.ts`
- [ ] All public methods are covered by at least one test
- [ ] Tests use **mock repositories** (no real database calls in unit tests)
- [ ] Edge cases are tested (null values, empty strings, not found, etc.)
- [ ] Tests follow **Arrange → Act → Assert** pattern
- [ ] Tests run successfully: `node ace test --suite unit`
- [ ] Uses subpath imports (`#services/...`, `#repositories/...`)
- [ ] **No `any` types** — all method parameters and return types are explicit
- [ ] DTOs/interfaces defined for method parameters (not inline object types)
- [ ] Return types annotated on all public methods
- [ ] Repository interfaces typed for shared contract between real and mock
