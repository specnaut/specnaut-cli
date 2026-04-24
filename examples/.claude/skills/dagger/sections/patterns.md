# Dagger Pipeline Patterns

## Full CI Pipeline Pattern

A complete pipeline for a Node.js + PostgreSQL + Redis project:

```typescript
import { dag, object, func, Container, Directory, Service, CacheVolume } from "@dagger.io/dagger"

@object()
class Ci {
  /**
   * PostgreSQL service for tests
   */
  @func()
  postgres(): Service {
    return dag.container()
      .from("postgres:18")
      .withEnvVariable("POSTGRES_USER", "postgres")
      .withEnvVariable("POSTGRES_PASSWORD", "postgres")
      .withEnvVariable("POSTGRES_DB", "app_test")
      .withExposedPort(5432)
      .asService()
  }

  /**
   * Redis service for tests
   */
  @func()
  redis(): Service {
    return dag.container()
      .from("redis:7-alpine")
      .withExposedPort(6379)
      .asService()
  }

  /**
   * Base container with dependencies installed
   */
  @func()
  deps(source: Directory): Container {
    return dag.container()
      .from("node:22-slim")
      .withMountedDirectory("/app", source)
      .withWorkdir("/app")
      .withMountedCache("/app/node_modules", dag.cacheVolume("node-modules"))
      .withMountedCache("/root/.npm", dag.cacheVolume("npm-cache"))
      .withExec(["npm", "ci"])
  }

  /**
   * Container with services bound and environment configured
   */
  @func()
  testEnv(source: Directory): Container {
    return this.deps(source)
      .withServiceBinding("db", this.postgres())
      .withServiceBinding("redis", this.redis())
      .withEnvVariable("NODE_ENV", "test")
      .withEnvVariable("DB_HOST", "db")
      .withEnvVariable("DB_PORT", "5432")
      .withEnvVariable("DB_USER", "postgres")
      .withEnvVariable("DB_PASSWORD", "postgres")
      .withEnvVariable("DB_DATABASE", "app_test")
      .withEnvVariable("REDIS_HOST", "redis")
      .withEnvVariable("REDIS_PORT", "6379")
  }

  /**
   * Run linting
   */
  @func()
  async lint(source: Directory): Promise<string> {
    return await this.deps(source)
      .withExec(["npm", "run", "lint"])
      .stdout()
  }

  /**
   * Run format check
   */
  @func()
  async format(source: Directory): Promise<string> {
    return await this.deps(source)
      .withExec(["npm", "run", "format", "--", "--check"])
      .stdout()
  }

  /**
   * Run TypeScript type check
   */
  @func()
  async typecheck(source: Directory): Promise<string> {
    return await this.deps(source)
      .withExec(["npm", "run", "typecheck"])
      .stdout()
  }

  /**
   * Run tests (unit + functional)
   */
  @func()
  async test(source: Directory): Promise<string> {
    const env = this.testEnv(source)

    // Migrate first
    await env.withExec(["node", "ace", "migration:run", "--force"]).sync()

    // Run tests
    return await env
      .withExec(["node", "ace", "test", "unit", "functional"])
      .stdout()
  }

  /**
   * Run all checks
   */
  @func()
  async all(source: Directory): Promise<string> {
    // Quality checks (no DB needed)
    await this.deps(source).withExec(["npm", "run", "format", "--", "--check"]).sync()
    await this.deps(source).withExec(["npm", "run", "lint"]).sync()
    await this.deps(source).withExec(["npm", "run", "typecheck"]).sync()

    // Tests (need DB + Redis)
    const result = await this.test(source)
    return result
  }
}
```

## Parallel Execution

Dagger evaluates lazily. You can trigger parallel execution by creating
multiple promises and awaiting them together:

```typescript
@func()
async all(source: Directory): Promise<string> {
  // These run in parallel because they're independent containers
  const [lintResult, formatResult, typecheckResult] = await Promise.all([
    this.deps(source).withExec(["npm", "run", "lint"]).stdout(),
    this.deps(source).withExec(["npm", "run", "format", "--", "--check"]).stdout(),
    this.deps(source).withExec(["npm", "run", "typecheck"]).stdout(),
  ])

  // Tests run after quality checks pass
  const testResult = await this.test(source)
  return `All checks passed.\n${testResult}`
}
```

## Database Migration + Seeding Pattern

For projects that need migrations and reference data before tests:

```typescript
@func()
async test(source: Directory): Promise<string> {
  const env = this.testEnv(source)

  // Run migrations
  await env.withExec(["node", "ace", "migration:run", "--force"]).sync()

  // Seed reference data
  await env.withExec(["node", "ace", "db:seed"]).sync()

  // Run tests
  return await env
    .withExec(["node", "ace", "test", "unit", "functional"])
    .stdout()
}
```

## Browser Test Pattern

Browser tests need Playwright installed and an app server running:

```typescript
@func()
async browserTest(source: Directory): Promise<string> {
  const playwrightCache = dag.cacheVolume("playwright-browsers")

  // Build the app
  const built = this.testEnv(source)
    .withExec(["node", "ace", "build"])

  // Install Playwright
  const withPlaywright = built
    .withMountedCache("/root/.cache/ms-playwright", playwrightCache)
    .withExec(["npx", "playwright", "install", "--with-deps", "chromium"])

  // Run migrations + seed
  await withPlaywright
    .withExec(["node", "ace", "migration:run", "--force"])
    .sync()

  // Run browser tests
  return await withPlaywright
    .withExec(["node", "ace", "test", "browser"])
    .stdout()
}
```

## Error Handling Pattern

Dagger pipeline failures propagate as exceptions. Use try/catch for reporting:

```typescript
@func()
async all(source: Directory): Promise<string> {
  const results: string[] = []

  try {
    await this.lint(source)
    results.push("lint: PASS")
  } catch (e) {
    results.push(`lint: FAIL - ${e}`)
    throw e  // fail fast
  }

  // ... more checks

  return results.join("\n")
}
```

## Environment Variable Pattern

Centralize environment configuration:

```typescript
@object()
class Ci {
  private testVars(container: Container): Container {
    return container
      .withEnvVariable("NODE_ENV", "test")
      .withEnvVariable("APP_KEY", "test-app-key-at-least-16-chars")
      .withEnvVariable("SESSION_DRIVER", "memory")
      .withEnvVariable("DRIVE_DISK", "fs")
      .withEnvVariable("DB_HOST", "db")
      .withEnvVariable("DB_PORT", "5432")
      .withEnvVariable("DB_USER", "postgres")
      .withEnvVariable("DB_PASSWORD", "postgres")
      .withEnvVariable("DB_DATABASE", "app_test")
      .withEnvVariable("REDIS_HOST", "redis")
      .withEnvVariable("REDIS_PORT", "6379")
  }

  @func()
  testEnv(source: Directory): Container {
    return this.testVars(
      this.deps(source)
        .withServiceBinding("db", this.postgres())
        .withServiceBinding("redis", this.redis())
    )
  }
}
```
