---
name: dagger
description: Dagger CI pipeline development skill covering TypeScript SDK, module structure, service containers, caching, GitHub Actions integration, and best practices for building reproducible CI pipelines.
---

# Dagger CI Pipeline Skill

This skill provides complete reference for building Dagger CI pipelines using
the **TypeScript SDK**. It covers module creation, service containers
(PostgreSQL, Redis), caching, and GitHub Actions integration.

## Sections Index

Read the section(s) relevant to your current task:

| Section                                                  | When to read                                        |
| :------------------------------------------------------- | :-------------------------------------------------- |
| [Module Structure](sections/module-structure.md)         | Initializing or modifying a Dagger module           |
| [TypeScript SDK](sections/typescript-sdk.md)             | Writing Dagger Functions with decorators and types   |
| [Service Containers](sections/service-containers.md)     | Provisioning PostgreSQL, Redis, or other services    |
| [Caching](sections/caching.md)                          | Optimizing pipeline speed with cache volumes         |
| [GitHub Actions](sections/github-actions.md)             | Integrating Dagger into CI workflows                 |
| [Patterns](sections/patterns.md)                        | Common pipeline patterns and best practices          |

## Quick Reference

### Initialize a Dagger module

```bash
# From project root
dagger init --sdk=typescript --name=ci
dagger develop   # generates bindings, installs SDK
```

Creates `.dagger/` with `dagger.json`, `src/index.ts`, `package.json`,
`tsconfig.json`.

### Run locally

```bash
dagger call test --source=.
dagger call lint --source=.
dagger call all --source=.    # run everything
```

### Run in GitHub Actions

```yaml
- uses: dagger/dagger-for-github@v8.4.1
  with:
    version: "latest"
    call: all --source=.
```

## Core Concepts

| Concept            | Description                                                              |
| :----------------- | :----------------------------------------------------------------------- |
| **Module**         | A self-contained Dagger project (`.dagger/`) with functions              |
| **Function**       | A `@func()` decorated method exposed as a callable pipeline step         |
| **Container**      | An OCI container used to run commands (`dag.container().from(...)`)      |
| **Service**        | A long-running container (`container.asService()`) bound to others       |
| **Directory**      | Source code or files passed as `Directory` type arguments                 |
| **CacheVolume**    | Persistent cache between runs (`dag.cacheVolume("key")`)                 |
| **Secret**         | Sensitive values passed securely (`dag.setSecret("name", "value")`)      |
| **Lazy Evaluation**| Nothing executes until a terminal method (`.stdout()`, `.sync()`) awaits |

## Key Rules

- **One `@object()` class per module** -- class name must match module name
  (PascalCase)
- **Function names are kebab-cased** in CLI: `buildContainer` becomes
  `build-container`
- **`withExec` takes an array** -- no shell expansion. For shell: use
  `["sh", "-c", "cmd1 && cmd2"]`
- **Services are ephemeral** -- started on demand, stopped when caller finishes
- **Containers are sandboxed** -- no host access unless explicitly passed via
  `Directory` or `Secret` arguments
- **Return types must be explicit** -- `Container`, `Promise<string>`, `Service`

## Versions

| Component          | Recommended            |
| :----------------- | :--------------------- |
| Dagger CLI         | latest (0.20.5+)       |
| TypeScript SDK     | `@dagger.io/dagger`    |
| GitHub Action      | `dagger/dagger-for-github@v8.4.1` |
| Node base image    | `node:22-slim` or project-specific |
