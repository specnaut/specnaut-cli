---
name: write-tests
description: Expert guide for writing Japa + Playwright browser tests, functional API tests, and unit tests. Covers all known pitfalls, patterns, and project-specific gotchas.
---

# Testing Skill — Japa + Playwright Expert

This skill contains **every known pitfall and pattern** for writing tests in this
project. Read it **before** writing any test. Following these rules avoids the
common multi-iteration debugging loops.

## Stack

- **Runner:** Japa with `@japa/runner`
- **Browser:** Playwright via `@japa/browser-client` (suite: `browser`)
- **API:** `@japa/api-client` with session, auth, shield plugins (suite:
  `functional`)
- **Assertions:** `@japa/assert`
- **Framework:** AdonisJS v7 (test server auto-starts)

## Test Suites

| Suite        | Dir                 | Tools available              | When to use                      |
| :----------- | :------------------ | :--------------------------- | :------------------------------- |
| `browser`    | `tests/browser/`    | `visit`, `page` (Playwright) | UI interactions, form flows      |
| `functional` | `tests/functional/` | `client` (API), `assert`     | HTTP endpoints, validation, auth |
| `unit`       | `tests/unit/`       | `assert` only                | Services, transformers, logic    |

---

## CRITICAL PITFALLS — Read First

### 1. `networkidle` hangs with SSE/Transmit

**Symptom:** Test hangs forever, times out after 30s.

**Cause:** SSE (`@adonisjs/transmit`) keeps a persistent HTTP connection open.
`waitForLoadState('networkidle')` waits for zero network activity — which never
happens.

**Cascading breakage:** Adding a component with SSE hooks (e.g., `useUnreadCount`,
`useUnreadChatCount`) to a **shared layout** retroactively breaks every browser
test that navigates to pages using that layout — even if those tests were passing
before and were never modified. This happened when `MobileBottomNav` (which uses
`useUnreadCount` for the notification badge) was added to all authenticated
layouts: every test using `waitForLoadState('networkidle')` on `/profile/edit`,
`/feed`, or any authenticated page started timing out.

**When modifying layouts:** After adding SSE-connected components to layouts,
immediately grep for `networkidle` in `tests/browser/` and replace all
occurrences on affected pages.

```typescript
// WRONG — hangs on ANY authenticated page (all layouts now have SSE via MobileBottomNav)
await page.waitForLoadState('networkidle')

// RIGHT — wait for a specific DOM element
await page.waitForSelector('text=Settings', { timeout: 10000 })

// ACCEPTABLE — if you just need the page structure ready (no SSE dependency)
await page.waitForLoadState('domcontentloaded')
```

**Rule:** NEVER use `networkidle` on any authenticated page. All authenticated
layouts include `MobileBottomNav` which uses SSE hooks. Use `waitForSelector`
for a known element, or `domcontentloaded` as a fallback. Only use `networkidle`
on fully public pages with no SSE (e.g., the login page before authentication,
public portfolio pages for unauthenticated visitors).

### 2. Selector ambiguity — dual nav (desktop + mobile)

**Symptom:** `strict mode violation: locator resolved to 2 elements`

**Cause:** Responsive layouts render both desktop and mobile versions in the DOM.
CSS hides one via `hidden lg:flex`, but Playwright sees both.

```typescript
// WRONG — matches both desktop and mobile nav
await page.locator('button:has-text("Profile")').click()

// RIGHT — scope to the desktop sidebar
const desktopNav = page.locator('aside nav ul').first()
await desktopNav.locator('button:has-text("Profile")').click()

// RIGHT — scope to a section by ID
const section = page.locator('#social-links')
await section.locator('input[placeholder="https://instagram.com/..."]').fill('...')
```

**Rule:** Always scope selectors to the nearest unique parent when the page has
responsive duplicates.

### 3. Silent server-side validation failures

**Symptom:** Form submits (303 redirect), but DB row is unchanged or null.

**Cause:** Controller wraps validation in `try/catch {}` and silently ignores
failures. Common with model details, agency details, social links.

```typescript
// In the controller:
try {
  const data = await request.validateUsing(updateModelDetailsValidator)
  await this.service.update(userId, data)
} catch {
  // Silent — validation error swallowed
}
```

**Rule:** If a browser test asserts DB state after form submission and the
assertion fails despite correct input values — **check the server-side
validator**. The catch block may be swallowing the error. In that case, test the
feature via a functional API test instead of a browser test.

### 4. React `onChange` and number inputs

**Symptom:** `fill()` works (value shows in browser), but React state doesn't
update. Server receives the old value.

**Cause:** `fill()` sets the value but may not trigger React's synthetic
`onChange` event on `type="number"` inputs.

```typescript
// Usually works:
await input.fill('175')

// If React doesn't pick up the value, try:
await input.click({ clickCount: 3 }) // Select all
await input.pressSequentially('175', { delay: 30 })

// Nuclear option — bypass React entirely:
await input.evaluate((el, val) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, val)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}, '175')
```

**Rule:** For text inputs, `fill()` works. For number inputs with React
controlled components, verify the value was picked up by checking `inputValue()`
before submitting.

### 5. Missing CSRF token in functional tests

**Symptom:** 403 Forbidden on POST/PUT/DELETE.

```typescript
// WRONG
await client.post('/notices').form({ ... }).loginAs(user)

// RIGHT
await client.post('/notices').form({ ... }).loginAs(user).withCsrfToken()
```

### 6. Auth middleware returns 200, not 302, with Inertia

**Symptom:** Test asserts `302` for unauthenticated access, but gets `200`.

**Cause:** When Inertia middleware is active, the AdonisJS auth guard does NOT
return a raw HTTP 302 redirect. Instead, it returns a `200` response containing
an Inertia redirect payload (the client-side router handles the redirect to
`/login`). This applies to ALL authenticated routes — GET and mutations alike.

```typescript
// WRONG — expects classic HTTP redirect
const response = await client.get('/settings/notifications')
response.assertStatus(302)

// RIGHT — Inertia auth returns 200 with client-side redirect
const response = await client.get('/settings/notifications')
response.assertStatus(200)

// BETTER — if you want to verify the redirect target, check the response body
const response = await client.get('/settings/notifications')
response.assertStatus(200)
// The Inertia response body contains the redirect URL
```

**Rule:** On protected routes, unauthenticated requests return `200` (not `302`)
because Inertia handles redirects client-side. Never assert `302` for auth
checks on Inertia-enabled routes.

### 7. Hardcoded URLs break in CI

**Symptom:** Tests pass locally, fail in CI.

**Cause:** CI test server runs on a random port, not `localhost:3333`.

```typescript
// WRONG
await page.goto('http://localhost:3333/profile/edit')

// RIGHT
const baseUrl = new URL(page.url()).origin
await page.goto(`${baseUrl}/profile/edit`)
```

### 8. Geolocation onboarding prompt blocks UI

**Symptom:** Test can't find elements — modal overlay is blocking.

**Cause:** New users get a geolocation prompt on first page load.

```typescript
// Prevention: set geolocPrompted: true when creating test user
await User.create({ ..., geolocPrompted: true })

// Fallback: dismiss in test
const notNowButton = page.locator('button:has-text("Not Now")')
if ((await notNowButton.count()) > 0) {
  await notNowButton.click()
  await page.waitForTimeout(500)
}
```

---

## Browser Test Patterns

### Login helper

```typescript
async function loginAndGoTo(visit: any, path: string) {
  const page = await visit('/login')
  await page.waitForSelector('#email', { timeout: 10000 })

  await page.locator('#email').fill(TEST_EMAIL)
  await page.locator('#password').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/(feed|onboarding)$/, { timeout: 10000 })

  const baseUrl = new URL(page.url()).origin
  await page.goto(`${baseUrl}${path}`)

  // NEVER use networkidle here — all authenticated pages have SSE via MobileBottomNav.
  // Use domcontentloaded + a specific selector for the target page.
  await page.waitForLoadState('domcontentloaded')

  // Dismiss geo prompt
  const notNowButton = page.locator('button:has-text("Not Now")')
  if ((await notNowButton.count()) > 0) {
    await notNowButton.click()
    await page.waitForTimeout(500)
  }

  return page
}
```

### Form submission with response wait

```typescript
await Promise.all([
  page.waitForResponse(
    (res: { url(): string; request(): { method(): string } }) =>
      res.url().endsWith('/endpoint') && res.request().method() === 'PUT'
  ),
  page.locator('button[type="submit"]:has-text("Save")').click(),
])
```

**Never** click and then wait separately — race condition.

### Unique content for assertions

```typescript
const uniqueTitle = `Test Notice ${Date.now()}`
await page.locator('#title').fill(uniqueTitle)

// Later:
await page.waitForSelector(`text=${uniqueTitle}`, { timeout: 5000 })
```

### Future dates (for notices, tours)

```typescript
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
```

Never hardcode dates — they expire and break tests.

### Autocomplete / debounced inputs

```typescript
await page.locator('#city').pressSequentially('Montreal', { delay: 10 })
await page.waitForTimeout(500) // Wait for dropdown
await page.locator('[role="option"]').first().click()
```

Use `pressSequentially` with delay — `fill()` doesn't trigger debounce.

### Detect React crashes

```typescript
const errorOverlay = await page.locator('vite-error-overlay').count()
if (errorOverlay > 0) {
  throw new Error('React/Vite Error Overlay detected!')
}
```

### Debug a failing test

```typescript
// 1. Capture HTML snapshot
const html = await page.content()
console.log('HTML:', html.slice(0, 2000))

// 2. Log browser console
page.on('console', (msg) => console.log('BROWSER:', msg.text()))

// 3. Check input values
const val = await page.locator('#firstName').inputValue()
console.log('firstName value:', val)
```

---

## Functional Test Patterns

### Database transaction (auto-rollback)

```typescript
import db from '@adonisjs/lucid/services/db'

test.group('Feature', (group) => {
  group.each.setup(async () => {
    await db.beginGlobalTransaction()
    return () => db.rollbackGlobalTransaction()
  })
})
```

Every test starts clean — no teardown needed.

### Authenticated API requests

```typescript
const response = await client
  .post('/notices')
  .form({ 'title': 'Test', 'targetRoleIds[]': [1, 2] })
  .loginAs(user)
  .withCsrfToken()

response.assertStatus(200)
```

### Validation error testing

```typescript
const countBefore = await Notice.query().where('userId', user.id).count('* as total')
const before = Number(countBefore[0].$extras.total)

await client
  .post('/notices')
  .form({
    /* invalid data */
  })
  .loginAs(user)
  .withCsrfToken()

const countAfter = await Notice.query().where('userId', user.id).count('* as total')
assert.equal(Number(countAfter[0].$extras.total), before) // Count unchanged
```

Don't check response body — check that DB state didn't change.

---

## Unit Test Patterns

### Mock dependencies via constructor

```typescript
const mockRepo = {
  findById: async () => ({ id: 1, name: 'Test' }),
  update: async () => {},
}
const service = new MyService(mockRepo as any, new MockAppCache())
```

Use `as any` to avoid mocking every method — only mock what the test needs.

### Capture passed data

```typescript
let capturedData: any = null
const mockRepo = {
  update: async (_id: number, data: any) => {
    capturedData = data
  },
}

await service.doSomething(1, { name: 'Test' })
assert.equal(capturedData.name, 'Test')
```

### Error assertions

```typescript
await assert.rejects(async () => service.doSomething(999), 'User not found')
```

---

## Test Data Setup

### Reference data (idempotent)

```typescript
await Role.updateOrCreateMany('name', [{ name: 'Model' }, { name: 'Photographer' }])
```

`updateOrCreateMany` is safe to run multiple times.

### Genre with role association

```typescript
const genre = await Genre.firstOrCreate(
  { name: 'Portrait' },
  { name: 'Portrait', nsfwLevel: 'none' }
)
const hasRole = await genre.related('roles').query().where('role_id', modelRole.id).first()
if (!hasRole) await genre.related('roles').attach([modelRole.id])
```

Check before attaching to avoid duplicate pivot entries.

### User cleanup pattern

```typescript
group.setup(async () => {
  const existing = await User.findBy('email', TEST_EMAIL)
  if (existing) await existing.delete()

  await User.create({ ..., geolocPrompted: true })
})

group.teardown(async () => {
  const user = await User.findBy('email', TEST_EMAIL)
  if (user) await user.delete()
})
```

Always cleanup in **both** setup (for crashed previous runs) and teardown.

---

## Decision Matrix: Which Test Type?

| Scenario                        | Test type      | Why                                                |
| :------------------------------ | :------------- | :------------------------------------------------- |
| Form fill → save → verify DB    | **browser**    | Tests real UI flow end-to-end                      |
| API validation (400/422)        | **functional** | Faster, no browser overhead, check response status |
| Silent server catch blocks      | **functional** | Browser can't see swallowed errors                 |
| Service logic with mocks        | **unit**       | Fastest, isolated, no DB needed                    |
| UI rendering (sections visible) | **browser**    | Only browser can verify DOM                        |
| Auth/permissions                | **functional** | Test 401/403 status codes directly                 |
| Complex multi-step UI flow      | **browser**    | Simulates real user behavior                       |
| Transformer output              | **unit**       | Pure function, no side effects                     |

**Golden rule:** If a browser test fails and you can't tell why after 2
attempts, drop to a functional test. Browser tests should test the **UI flow**,
not the server logic.

---

## Troubleshooting Checklist

When a test fails, check in this order:

1. **Is `networkidle` used on an authenticated page?** All authenticated pages
   have SSE via `MobileBottomNav` — replace with `waitForSelector` or
   `domcontentloaded`. This is the #1 cause of 30s timeout failures.
2. **Is the selector unique?** Use browser DevTools to verify
3. **Is React hydrated?** Add `waitForSelector` before interacting
4. **Is the geo prompt visible?** Set `geolocPrompted: true` or dismiss it
5. **Did the server silently fail?** Check DB state, not just UI
6. **Is the CSRF token included?** Add `.withCsrfToken()` for mutations
7. **Is the URL dynamic?** Use `new URL(page.url()).origin` for base URL
8. **Are dates in the future?** Use `Date.now() + offset`, never hardcode
