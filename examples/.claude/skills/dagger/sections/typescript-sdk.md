# Dagger TypeScript SDK

## Imports

```typescript
import {
  dag,
  object,
  func,
  field,
  Container,
  Directory,
  Service,
  CacheVolume,
  Secret,
} from "@dagger.io/dagger"
```

## Decorators

### `@object()`

Marks a class as a Dagger object. **One per module.** Class name must match
module name in PascalCase.

```typescript
@object()
class Ci {
  // ...
}
```

### `@func()`

Exposes a method as a callable Dagger Function. Must have explicit return type.

```typescript
@object()
class Ci {
  @func()
  build(source: Directory): Container {
    return dag.container().from("node:22-slim")
      .withMountedDirectory("/app", source)
      .withWorkdir("/app")
      .withExec(["npm", "run", "build"])
  }

  @func()
  async test(source: Directory): Promise<string> {
    return await this.build(source)
      .withExec(["npm", "test"])
      .stdout()
  }
}
```

### `@field()`

Exposes a class property as a configurable field.

```typescript
@object()
class Ci {
  @field()
  nodeVersion = "22"

  @func()
  base(): Container {
    return dag.container().from(`node:${this.nodeVersion}-slim`)
  }
}
```

## Core Types

| Type           | Description                                    | Terminal methods                     |
| :------------- | :--------------------------------------------- | :----------------------------------- |
| `Container`    | An OCI container with chainable operations     | `.stdout()`, `.stderr()`, `.sync()`  |
| `Directory`    | A filesystem directory (source code, artifacts)| `.file()`, `.entries()`              |
| `Service`      | A running service container                    | N/A (bound to other containers)      |
| `CacheVolume`  | A persistent cache between runs                | N/A (mounted on containers)          |
| `Secret`       | A sensitive value                              | `.plaintext()` (avoid in pipelines)  |
| `File`         | A single file                                  | `.contents()`                        |

## Container Operations

### Building a container

```typescript
dag.container()
  .from("node:22-slim")                          // base image
  .withMountedDirectory("/app", source)           // mount source code
  .withWorkdir("/app")                            // set working directory
  .withEnvVariable("NODE_ENV", "test")            // set env var
  .withExec(["npm", "ci"])                        // run command
```

### Chaining commands

Each `withExec` adds a layer. Commands run sequentially:

```typescript
dag.container()
  .from("node:22-slim")
  .withExec(["npm", "ci"])
  .withExec(["npm", "run", "build"])
  .withExec(["npm", "test"])
```

### Shell commands

`withExec` takes an array (no shell expansion). For shell:

```typescript
container.withExec(["sh", "-c", "echo $HOME && ls -la"])
```

### Environment variables

```typescript
container
  .withEnvVariable("DB_HOST", "db")
  .withEnvVariable("DB_PORT", "5432")
  .withEnvVariable("CACHEBUSTER", Date.now().toString()) // bust cache
```

**Note:** `withEnvVariable` with a changing value (like timestamp) busts the
cache for all subsequent layers. Use this intentionally.

### Secrets

```typescript
const secret = dag.setSecret("db-password", "s3cret")
container.withSecretVariable("DB_PASSWORD", secret)
```

### Mounting files

```typescript
// Mount a directory
container.withMountedDirectory("/app", source)

// Mount a cache volume
container.withMountedCache("/app/node_modules", dag.cacheVolume("node-modules"))

// Mount a single file
container.withMountedFile("/app/.env", envFile)
```

## Terminal Methods (Triggering Execution)

Nothing executes until you call a terminal method:

```typescript
// Get stdout
const output = await container.withExec(["echo", "hello"]).stdout()

// Get stderr
const errors = await container.withExec(["npm", "test"]).stderr()

// Sync (execute without capturing output -- useful for side effects)
await container.withExec(["npm", "test"]).sync()

// Export container as tarball
await container.export("/tmp/image.tar")
```

## Function Arguments

### Required arguments

```typescript
@func()
test(source: Directory): Container { ... }
// CLI: dagger call test --source=.
```

### Optional arguments with defaults

```typescript
@func()
build(source: Directory, target = "production"): Container { ... }
// CLI: dagger call build --source=. --target=staging
```

### Multiple arguments

```typescript
@func()
deploy(source: Directory, registry: string, tag = "latest"): Promise<string> { ... }
// CLI: dagger call deploy --source=. --registry=ghcr.io/me/app --tag=v1.0
```

## Composition Pattern

Methods can call other methods for reusable pipeline stages:

```typescript
@object()
class Ci {
  @func()
  deps(source: Directory): Container {
    return dag.container()
      .from("node:22-slim")
      .withMountedDirectory("/app", source)
      .withWorkdir("/app")
      .withMountedCache("/app/node_modules", dag.cacheVolume("node-modules"))
      .withExec(["npm", "ci"])
  }

  @func()
  build(source: Directory): Container {
    return this.deps(source)
      .withExec(["npm", "run", "build"])
  }

  @func()
  async test(source: Directory): Promise<string> {
    return await this.deps(source)
      .withExec(["npm", "test"])
      .stdout()
  }

  @func()
  async all(source: Directory): Promise<string> {
    // Run all checks -- each awaited independently
    await this.deps(source).withExec(["npm", "run", "lint"]).sync()
    await this.deps(source).withExec(["npm", "run", "typecheck"]).sync()
    const testOutput = await this.test(source)
    return testOutput
  }
}
```
