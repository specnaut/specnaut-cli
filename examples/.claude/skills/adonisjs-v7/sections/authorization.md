# Authorization (Bouncer)

AdonisJS relies on **Bouncer** for authorization checks in v7. We use **Policies** rather than inline checks or actions, as they encapsulate the authorization logic at the Model level.

## Key Principles

- **No manual IDs check:** Do not do `if (user.id !== post.userId)` in controllers or services. This logic goes inside Bouncer Policies.
- **Fail by default:** If a policy check doesn't explicitly return `true`, it is denied.
- **Controller integration:** Let Bouncer handle authorization before delegating the task to the service layer.

## Example Policy

```bash
# Create a policy explicitly attached to a model
node ace make:policy Post
```

```typescript
// app/policies/post_policy.ts
import User from '#models/user'
import Post from '#models/post'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class PostPolicy extends BasePolicy {
  // `before` hook runs before any action. Returning `true` instantly approves.
  before(user: User | null) {
    if (user && user.isAdmin) return true
  }

  // A standard action
  update(user: User, post: Post): AuthorizerResponse {
    return user.id === post.userId
  }
}
```

## Integrating in Controllers

In your controller, you can authorize using the context's `bouncer`:

```typescript
import PostPolicy from '#policies/post_policy'

export default class PostsController {
  async destroy({ bouncer, params, response }: HttpContext) {
    const post = await this.postService.resolvePostByUuid(params.uuid)

    // Throws an E_AUTHORIZATION_FAILURE (HTTP 403) internally if it evaluates to false
    await bouncer.with(PostPolicy).authorize('delete', post)

    await this.postService.deletePost(params.uuid)
    return response.json({ deleted: true })
  }
}
```

---

## ⚠️ CRITICAL: Handling HTTP Errors and Inertia Tests

In our architecture, AdonisJS works tandem with **Inertia.js**. You MUST be highly aware of how Bouncer failures are managed globally via the `HttpExceptionHandler` (`app/exceptions/handler.ts`):

1. **The Core Problem**: Bouncer's `authorize` explicitly throws an `E_AUTHORIZATION_FAILURE` exception.
2. **The Inertia Interception**: By default, `statusPages` in `HttpExceptionHandler` catches the 403 error and uses `inertia.render('errors/forbidden')`.
3. **The HTTP Response Trap**: Since Inertia intercepts the failing logic to render a visual error page, the server returns an **HTTP status 200 (Success)** for the page load! It DOES NOT return a 403 status to the browser unless forcibly configured, because Inertia requires valid JSON payload structures for its navigation system without flashing browser error screens.

### Why this matters for Functional Tests (Japa)

If you are writing a functional test for an unauthorized action (expecting a 403 status) on an endpoint serving an Inertia JSON action, **it will mistakenly receive a 200 OK** because the Exception handler returned the graphical `errors/forbidden` response!

**❌ BAD (Will fail with "expected 200 to equal 403"):**

```typescript
test('non-author cannot delete post', async ({ client }) => {
  const response = await client.delete(`/posts/${post.uuid}`).loginAs(otherUser)
  response.assertStatus(403) // FAILS: It receives 200!
})
```

**✅ GOOD (Forces the framework to yield a true JSON 403 API response):**

```typescript
test('non-author cannot delete post', async ({ client }) => {
  const response = await client
    .delete(`/posts/${post.uuid}`)
    .loginAs(otherUser)
    .header('Accept', 'application/json') // <-- CRITICAL FIX

  response.assertStatus(403) // PASSES!
})
```

Always add `.header('Accept', 'application/json')` in your functional tests for mutations/actions so AdonisJS bypasses the Inertia `statusPages` HTML shield and natively returns the RAW API 403/404 JSON response.
