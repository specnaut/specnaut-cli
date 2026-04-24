---
name: adonisjs-v7
description: Complete AdonisJS v7 development skill covering architecture (Controller → Service → Repository), models, migrations, seeders, validators, error handling, testing, Inertia.js pages, SSE with Transmit, and official docs reference.
---

# AdonisJS v7 Development Skill

This is the **unified skill** for all AdonisJS v7 backend and Inertia.js
development in the Miximodel project. It covers the full stack from database to
HTTP response, including real-time SSE.

## Sections Index

Read the section(s) relevant to your current task:

| Section                                      | When to read                                               |
| :------------------------------------------- | :--------------------------------------------------------- |
| [Architecture](sections/architecture.md)     | Understanding the Controller → Service → Repository layers |
| [Controllers](sections/controllers.md)       | Creating or modifying a controller                         |
| [Services](sections/services.md)             | Creating a service with unit tests                         |
| [Models](sections/models.md)                 | Creating or modifying a Lucid model                        |
| [Migrations](sections/migrations.md)         | Creating database migrations                               |
| [Seeders](sections/seeders.md)               | Creating database seeders                                  |
| [Validators](sections/validators.md)         | Creating VineJS validators                                 |
| [Authorization](sections/authorization.md)   | Bouncer policies, exceptions, and testing hurdles          |
| [Error Handling](sections/error_handling.md) | Custom exceptions and status pages                         |
| [Testing](sections/testing.md)               | Choosing and writing unit/functional/browser tests         |
| [Inertia Pages](sections/inertia.md)         | Creating end-to-end Inertia.js pages                       |
| [SSE Transmit](sections/sse_transmit.md)     | Real-time SSE with @adonisjs/transmit                      |
| [Cache](sections/cache.md)                   | Multi-tier caching with @adonisjs/cache (BentoCache)       |
| [Drive & Storage](sections/drive_storage.md) | File uploads, GCS integration, signed URLs, image processing |
| [Docs Reference](sections/docs_reference.md) | Finding the right AdonisJS documentation page              |

## Quick Start Scripts

Scaffold common file stacks in one command:

```bash
# Controller + Service + Repository + Test
bash .claude/skills/adonisjs-v7/scripts/create_controller.sh <Name>

# Service + Unit Test
bash .claude/skills/adonisjs-v7/scripts/create_service.sh <Name>

# Model
bash .claude/skills/adonisjs-v7/scripts/create_model.sh <ModelName>

# Migration (optionally with model)
bash .claude/skills/adonisjs-v7/scripts/create_migration.sh <table_name> [--with-model]

# Seeder
bash .claude/skills/adonisjs-v7/scripts/create_seeder.sh <Name>

# Fetch AdonisJS official documentation
node .claude/skills/adonisjs-v7/scripts/fetch-docs.js --list              # List all topics
node .claude/skills/adonisjs-v7/scripts/fetch-docs.js <topic>             # Fetch a specific topic
node .claude/skills/adonisjs-v7/scripts/fetch-docs.js --category <name>   # Fetch all in a category
```

## Core Principles

| Principle                | Rule                                                                     |
| :----------------------- | :----------------------------------------------------------------------- |
| **DRY**                  | Never duplicate logic — extract shared behavior into services or helpers |
| **KISS**                 | Keep each layer focused on a single responsibility                       |
| **Thin Controllers**     | Controllers only handle HTTP concerns: validate, delegate, respond       |
| **Service Layer**        | All business logic goes in `app/services/`                               |
| **Repository Pattern**   | All database queries go in `app/repositories/`                           |
| **Dependency Injection** | Use `@inject()` — never manually instantiate services or repositories    |
| **Testable by design**   | Every service must have accompanying unit tests                          |
| **Type safety**          | No `any` — use explicit types, DTOs, and return types everywhere         |

## Import Aliases

| Alias             | Path                    |
| :---------------- | :---------------------- |
| `#controllers/*`  | `app/controllers/*.js`  |
| `#services/*`     | `app/services/*.js`     |
| `#repositories/*` | `app/repositories/*.js` |
| `#models/*`       | `app/models/*.js`       |
| `#validators/*`   | `app/validators/*.js`   |
| `#database/*`     | `database/*.js`         |

> **Tip:** You can also use the `@mkrlbs/mcp-adonisjs` MCP tools (`check_docs`,
> `list_docs`, `make:*`) for quick access to AdonisJS commands and documentation.
