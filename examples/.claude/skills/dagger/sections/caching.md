# Dagger Caching

## Cache Volumes

`CacheVolume` persists data between pipeline runs. Mount it on a container path
to skip expensive operations (dependency install, build artifacts).

```typescript
const nodeModules = dag.cacheVolume("node-modules")

dag.container()
  .from("node:22-slim")
  .withMountedDirectory("/app", source)
  .withWorkdir("/app")
  .withMountedCache("/app/node_modules", nodeModules)
  .withExec(["npm", "ci"])
```

## Common Cache Patterns

### Node.js Dependencies

```typescript
@func()
deps(source: Directory): Container {
  const nodeModules = dag.cacheVolume("node-modules")
  const npmCache = dag.cacheVolume("npm-cache")

  return dag.container()
    .from("node:22-slim")
    .withMountedDirectory("/app", source)
    .withWorkdir("/app")
    .withMountedCache("/app/node_modules", nodeModules)
    .withMountedCache("/root/.npm", npmCache)
    .withExec(["npm", "ci"])
}
```

### Playwright Browsers

```typescript
@func()
browserDeps(source: Directory): Container {
  const playwrightCache = dag.cacheVolume("playwright-browsers")

  return this.deps(source)
    .withMountedCache("/root/.cache/ms-playwright", playwrightCache)
    .withExec(["npx", "playwright", "install", "--with-deps", "chromium"])
}
```

### Build Artifacts

```typescript
@func()
build(source: Directory): Container {
  const buildCache = dag.cacheVolume("build-output")

  return this.deps(source)
    .withMountedCache("/app/build", buildCache)
    .withExec(["npm", "run", "build"])
}
```

## Cache Keys

- Cache volumes are identified by their string key (e.g., `"node-modules"`)
- Same key = same volume across runs
- Different keys = isolated volumes
- Keys are scoped to the Dagger engine instance

## Cache Busting

To force a fresh run, use `withEnvVariable` with a changing value:

```typescript
container
  .withEnvVariable("CACHEBUSTER", Date.now().toString())
  .withExec(["npm", "ci"])  // will not use cached layer
```

## Layer Caching

Dagger also caches container layers automatically:

- If the base image, env vars, and mounted files haven't changed, the layer is
  reused
- `withExec` layers are cached based on the command + all preceding layers
- Changing a mount (new source code) invalidates subsequent layers

## Best Practices

1. **Mount node_modules as cache, not source** -- `npm ci` overwrites
   `node_modules` anyway, so a cache mount avoids re-downloading packages
2. **Separate npm cache from node_modules** -- mount both for maximum reuse
3. **Order operations by change frequency** -- put rarely-changing steps first
   (base image, system deps) and frequently-changing steps last (source code)
4. **Use explicit cache keys** -- descriptive names like `"node-modules"` over
   generic `"cache"`
5. **Don't cache test databases** -- ephemeral services should start fresh each
   run for test isolation
