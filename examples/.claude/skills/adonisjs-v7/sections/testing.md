# Testing Strategy

📖 **Documentation:**
[`testing/introduction.md`](https://docs.adonisjs.com/guides/testing/introduction.md)

## Test Suites

The project has 3 test suites configured in `adonisrc.ts`:

| Suite        | Directory                       | Timeout | When to use                               |
| :----------- | :------------------------------ | :------ | :---------------------------------------- |
| `unit`       | `tests/unit/**/*.spec.ts`       | 2s      | Pure logic — services, helpers, utilities |
| `functional` | `tests/functional/**/*.spec.ts` | 30s     | HTTP endpoints — request/response cycle   |
| `browser`    | `tests/browser/**/*.spec.ts`    | 300s    | E2E UI — Playwright interaction           |

## Decision Tree

```
Is it testing pure logic with no HTTP or DB?
  → Unit test

Is it testing an HTTP endpoint (status codes, responses)?
  → Functional test

Is it testing user interaction in the browser?
  → Browser test
```

## Unit Tests

**For:** Services, helpers, utilities, transformers
**Pattern:** Mock dependencies via constructor, test in isolation

```typescript
// tests/unit/services/project_service.spec.ts
import { test } from '@japa/runner'
import ProjectService from '#services/project_service'

test.group('ProjectService', () => {
  test('creates a project', async ({ assert }) => {
    const mockRepo = {
      create: async (data: any) => ({ id: 1, ...data }),
    }

    const service = new ProjectService(mockRepo as any)
    const project = await service.create({ name: 'Test' })

    assert.equal(project.name, 'Test')
  })
})
```

**Rules:**

- No database calls — mock repositories
- No HTTP context — pass plain data
- Fast (< 2s per test)
- See the **Services** section for detailed patterns

## Functional Tests

**For:** API endpoints, controller responses, middleware behavior
**Pattern:** Use `apiClient` to make real HTTP requests against the app

```typescript
// tests/functional/projects/list.spec.ts
import { test } from '@japa/runner'

test.group('GET /projects', () => {
  test('returns 200 with projects list', async ({ client }) => {
    const response = await client.get('/projects')

    response.assertStatus(200)
  })

  test('requires authentication', async ({ client }) => {
    const response = await client.get('/projects/create')

    response.assertStatus(302)
  })
})
```

**Rules:**

- Tests the full HTTP cycle (middleware, validation, response)
- Can use the database (via transactions or `refreshDatabase`)
- Tests status codes, redirects, response structure

## Browser Tests

**For:** Full user flows, visual interaction, form submission
**Pattern:** Playwright-based, interact with real UI

```typescript
// tests/browser/auth/login.spec.ts
import { test } from '@japa/runner'

test.group('Login flow', () => {
  test('user can login with valid credentials', async ({ visit }) => {
    const page = await visit('/login')

    await page.locator('#email').fill('user@test.com')
    await page.locator('#password').fill('password123')
    await page.locator('button[type="submit"]').click()

    await page.assertPath('/')
  })
})
```

**Rules:**

- Slowest suite — use only for critical user flows
- Tests real UI interaction
- Requires full app + database running

## File Naming

```
tests/
├── unit/
│   └── services/
│       └── project_service.spec.ts
├── functional/
│   └── projects/
│       ├── list.spec.ts
│       └── create.spec.ts
└── browser/
    └── auth/
        └── login.spec.ts
```

## Running Tests

```bash
# All tests
node ace test

# Specific suite
node ace test --suite unit
node ace test --suite functional
node ace test --suite browser

# Specific file
node ace test --suite unit --files "services/project_service"

# Watch mode
node ace test --suite unit --watch
```

## Checklist

- [ ] Correct suite chosen (unit / functional / browser)
- [ ] Test file in the right directory (`tests/<suite>/`)
- [ ] File named `*.spec.ts`
- [ ] Unit tests mock dependencies — no real DB calls
- [ ] Functional tests assert status codes and response structure
- [ ] Browser tests cover critical user flows only
- [ ] Tests pass: `node ace test --suite <name>`
