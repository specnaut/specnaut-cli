# Dagger Service Containers

Services are long-running containers (databases, caches, message brokers) that
other containers can connect to via `withServiceBinding`.

## Creating a Service

```typescript
@func()
postgres(): Service {
  return dag.container()
    .from("timescale/timescaledb-ha:pg18.3-ts2.25.2-all")
    .withEnvVariable("POSTGRES_USER", "postgres")
    .withEnvVariable("POSTGRES_PASSWORD", "postgres")
    .withEnvVariable("POSTGRES_DB", "app_test")
    .withExposedPort(5432)
    .asService()
}

@func()
redis(): Service {
  return dag.container()
    .from("redis:7-alpine")
    .withExposedPort(6379)
    .asService()
}
```

## Binding Services to Containers

Use `withServiceBinding(hostname, service)` to make a service reachable from
another container at the given hostname:

```typescript
@func()
async test(source: Directory): Promise<string> {
  const db = this.postgres()
  const cache = this.redis()

  return await this.deps(source)
    .withServiceBinding("db", db)           // reachable at hostname "db"
    .withServiceBinding("redis", cache)     // reachable at hostname "redis"
    .withEnvVariable("DB_HOST", "db")
    .withEnvVariable("DB_PORT", "5432")
    .withEnvVariable("REDIS_HOST", "redis")
    .withExec(["npm", "test"])
    .stdout()
}
```

## Key Behavior

### Lifecycle

- Services start **on demand** when a container with a binding first needs them
- Services stop **automatically** when the calling container exits
- Each `asService()` call creates a **new service instance**
- To share a service instance across multiple containers, store it in a variable

### Networking

- The hostname in `withServiceBinding("hostname", svc)` is how the bound
  container reaches the service
- **No host port mapping** -- containers communicate via internal DNS, not
  `localhost`
- No port conflicts with host services (no `--publish` equivalent)
- Multiple services can expose the same port (e.g., two PostgreSQL on 5432)
  because each gets a unique hostname

### Health Checks

Dagger waits for the service to be ready before proceeding. The service is
considered ready when its exposed port accepts connections. For databases that
need extra startup time, you can add an explicit wait:

```typescript
@func()
postgres(): Service {
  return dag.container()
    .from("postgres:18")
    .withEnvVariable("POSTGRES_PASSWORD", "postgres")
    .withExposedPort(5432)
    .asService({ useEntrypoint: true })
}
```

If the default health check is insufficient, add an init script:

```typescript
@func()
postgresReady(): Service {
  return dag.container()
    .from("postgres:18")
    .withEnvVariable("POSTGRES_PASSWORD", "postgres")
    .withExposedPort(5432)
    .asService()
}
```

### Sharing Services

Store the service in a variable to reuse the same instance:

```typescript
@func()
async all(source: Directory): Promise<string> {
  // Same DB instance for migrations and tests
  const db = this.postgres()

  const app = this.deps(source)
    .withServiceBinding("db", db)
    .withServiceBinding("redis", this.redis())

  // Migrate first, then test -- same DB
  await app.withExec(["node", "ace", "migration:run", "--force"]).sync()
  return await app.withExec(["npm", "test"]).stdout()
}
```

## Common Service Patterns

### PostgreSQL with Extensions (TimescaleDB)

```typescript
@func()
postgres(): Service {
  return dag.container()
    .from("timescale/timescaledb-ha:pg18.3-ts2.25.2-all")
    .withEnvVariable("POSTGRES_USER", "postgres")
    .withEnvVariable("POSTGRES_PASSWORD", "postgres")
    .withEnvVariable("POSTGRES_DB", "miximodel_test")
    .withExposedPort(5432)
    .asService()
}
```

### Redis

```typescript
@func()
redis(): Service {
  return dag.container()
    .from("redis:7-alpine")
    .withExposedPort(6379)
    .asService()
}
```

### App Server (for browser tests)

```typescript
@func()
appServer(source: Directory): Service {
  return this.deps(source)
    .withServiceBinding("db", this.postgres())
    .withServiceBinding("redis", this.redis())
    .withEnvVariable("HOST", "0.0.0.0")
    .withEnvVariable("PORT", "3333")
    .withExposedPort(3333)
    .withExec(["node", "bin/server.js"])
    .asService()
}
```
