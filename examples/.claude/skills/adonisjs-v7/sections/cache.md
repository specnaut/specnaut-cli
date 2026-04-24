# Cache (`@adonisjs/cache`)

> **Official doc:** https://docs.adonisjs.com/guides/digging-deeper/cache

## Overview

AdonisJS Cache is built on **BentoCache** and provides multi-tier caching with
stampede protection, grace periods, and tagging.

```ts
import cache from '@adonisjs/cache/services/main'
```

> **🚨 CRITICAL ARCHITECTURE RULE:** Services and Middleware must NEVER import the cache singleton directly. They MUST use Dependency Injection via the `AppCache` proxy class.

## Dependency Injection (Required Pattern)

To ensure services remain fully unit-testable and isolated, **never import the cache singleton statically in services or middleware**. Instead, inject the `AppCache` proxy class (`app/services/app_cache.ts`) via the constructor.

```ts
import { inject } from '@adonisjs/core'
import AppCache from '#services/app_cache'

@inject()
export default class MyService {
  constructor(private cache: AppCache) {}

  async getData() {
    return this.cache.getOrSet({
      key: 'my-key',
      ttl: '1h',
      factory: () => fetchSomeData(),
    })
  }
}
```

In unit tests, this allows injecting a `MockAppCache` (`tests/mocks/mock_app_cache.ts`) that uses an isolated, synchronous in-memory Map. This instantly solves test state leakage and ordering issues.

## Configuration

Config lives in `config/cache.ts`. Define one or more **stores**, each
composed of **layers** (L1 in-memory, L2 persistent) and an optional **bus**
for cross-instance invalidation.

```ts
import { defineConfig, store, drivers } from '@adonisjs/cache'

const cacheConfig = defineConfig({
  default: 'default',

  stores: {
    // Memory-only (single instance, short-lived)
    memoryOnly: store().useL1Layer(drivers.memory()),

    // Multi-tier: memory L1 + Redis L2 (recommended for prod)
    default: store()
      .useL1Layer(drivers.memory({ maxSize: '100mb' }))
      .useL2Layer(drivers.redis({ connectionName: 'main' })),
    // Add bus for multi-instance deployments:
    // .useBus(drivers.redisBus({ connectionName: 'main' })),
  },
})

export default cacheConfig
```

### Available Drivers

| Driver     | Layer | Package                    | Notes                                      |
| :--------- | :---- | :------------------------- | :----------------------------------------- |
| `memory`   | L1    | Built-in                   | LRU cache, fast, process-scoped            |
| `redis`    | L2    | `@adonisjs/redis`          | Persistent, distributed                    |
| `database` | L2    | `@adonisjs/lucid`          | Auto-creates `cache` table                 |
| `dynamodb` | L2    | `@aws-sdk/client-dynamodb` | Requires pre-created table                 |
| `redisBus` | Bus   | `@adonisjs/redis`          | Cross-instance L1 invalidation via pub/sub |

## Storing and Retrieving Data

### `getOrSet` — Read-through pattern (most common)

Tries L1 → L2 → factory. Stores result in both layers. Includes built-in
**stampede protection** (only one factory runs for concurrent requests on the
same key).

```ts
const data = await cache.getOrSet({
  key: 'ref:roles',
  ttl: '24h',
  factory: () => roleRepository.findAll(),
})
```

### `get` / `set` — Manual control

```ts
// Store
await cache.set({
  key: 'app:settings',
  value: { maintenance: false },
  ttl: '5m',
})

// Retrieve (returns undefined if missing)
const settings = await cache.get({ key: 'app:settings' })

// Store forever
await cache.setForever({ key: 'app:version', value: '2.0.0' })
```

### `has` / `missing`

```ts
if (await cache.has({ key: 'products:featured' })) {
  /* ... */
}
if (await cache.missing({ key: 'products:featured' })) {
  /* ... */
}
```

### `pull` — Get + delete in one operation

```ts
const token = await cache.pull({ key: `email-verify:${userId}` })
```

## Deleting Data

```ts
// Single key — invalidates BOTH L1 and L2
await cache.delete({ key: 'posts:page:1' })

// Multiple keys
await cache.deleteMany({
  keys: ['posts:page:1', 'posts:page:2'],
})

// Clear all entries
await cache.clear()
```

## Tagging

Group related entries for bulk invalidation:

```ts
// Store with tags
await cache.getOrSet({
  key: `posts:page:${page}`,
  ttl: '10m',
  tags: ['posts'],
  factory: () => Post.query().paginate(page, 20),
})

// Invalidate all entries tagged 'posts'
await cache.deleteByTag({ tags: ['posts'] })
```

> ⚠️ Avoid too many tags per entry — BentoCache uses client-side tagging,
> so each retrieval checks tag invalidation timestamps.

## Namespaces

Group keys under a common prefix with scoped `clear()`:

```ts
const usersCache = cache.namespace('users')
await usersCache.set({ key: '42', value: { name: 'John' } })
await usersCache.clear() // Only clears 'users:*'
```

## Multi-Tier Caching

### How It Works

- **Read:** L1 (memory) → L2 (Redis). If found in L2, copies to L1.
- **Write/Delete:** Updates **both layers**. Bus notifies other instances
  to evict stale L1 entries.

### ⚠️ Critical: L1 Invalidation

When using multi-tier caching, **always use `cache.delete()` to invalidate
entries** — never `redis-cli DEL` directly. Deleting directly from Redis
only clears L2; the L1 in-memory layer continues serving stale data until
the process restarts.

To invalidate from the CLI, use:

```bash
node ace cache:delete <key>
# or for tagged entries:
node ace cache:clear --tags=<tag>
```

## Grace Periods

Serve stale data while refreshing in the background — resilient to outages:

```ts
const products = await cache.getOrSet({
  key: 'products:featured',
  ttl: '10m',
  grace: '6h', // Stale data served for up to 6h if factory fails
  factory: () => Product.query().where('featured', true).exec(),
})
```

## Stampede Protection

Built-in, no configuration needed. When a key expires and 10,000 requests
arrive simultaneously, **only one factory execution** runs. All other
requests wait for the result.

## Ace Commands

```bash
# Clear the default store
node ace cache:clear

# Clear a specific store
node ace cache:clear redis

# Clear a namespace
node ace cache:clear --namespace=users

# Clear by tags
node ace cache:clear --tags=products --tags=users

# Delete a specific key
node ace cache:delete posts:page:1

# Prune expired entries (database/filesystem drivers only, not Redis)
node ace cache:prune
```

## Serialization

Cached data must be **JSON-serializable**. For Lucid models:

- Call `.toJSON()` or `.serialize()` before storing via `cache.set()`
- `getOrSet` handles serialization automatically
- Best practice: map Lucid results to plain objects in the **repository**
  before the service caches them

```ts
// ✅ Good — repository returns plain objects
async findAll(): Promise<{ id: number; name: string }[]> {
  const roles = await Role.query().select('id', 'name')
  return roles.map((r) => ({ id: r.id, name: r.name }))
}

// ❌ Bad — caching Lucid model instances directly via set()
await cache.set({ key: 'roles', value: await Role.all() })
```

## Project Conventions

| Convention                | Rule                                                                    |
| :------------------------ | :---------------------------------------------------------------------- |
| **Cache key constants**   | Centralize in `app/cache_keys.ts`, import via `#cache_keys`             |
| **Key naming**            | Colon-separated: `ref:roles`, `user:{id}:unread:notifications`          |
| **Dependency Injection**  | **Always** inject `AppCache` in services/middleware. No static imports. |
| **TTLs**                  | Reference data: `24h`, exchange rates: `1h`, suggestions: `5-10m`       |
| **Invalidation**          | Use `this.cache.delete()`, never raw Redis commands                     |
| **Custom purge commands** | Place in `commands/` directory (not `app/commands/`)                    |
| **Graceful degradation**  | Wrap cache ops in try/catch, fall back to DB on failure                 |
