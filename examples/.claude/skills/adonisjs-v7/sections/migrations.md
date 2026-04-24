# Migrations

📖 **Documentation:**
[`database-and-models.md`](https://docs.adonisjs.com/tutorial/hypermedia/database-and-models.md)

## Quick Start

```bash
# Migration only
bash .claude/skills/adonisjs-v7/scripts/create_migration.sh <table_name>

# Migration + Model together
bash .claude/skills/adonisjs-v7/scripts/create_migration.sh <table_name> --with-model
```

Or manually:

```bash
node ace make:migration <table_name>
node ace make:migration <table_name> -m   # also creates the model
```

## 🚨 CRITICAL: Auto-Generated Schema

> **⚠️ Running `node ace migration:run` auto-generates `database/schema.ts`.**
> This file contains all `@column()` decorators for every table. Models in
> `app/models/` extend these Schema classes — see the **Models** section.
>
> **Never edit `database/schema.ts` manually.**

## Naming Conventions

| Action           | Migration name                      | Example                                                   |
| :--------------- | :---------------------------------- | :-------------------------------------------------------- |
| Create table     | `create_<table>_table`              | `node ace make:migration create_projects_table`           |
| Add columns      | `add_<col>_to_<table>_table`        | `node ace make:migration add_status_to_projects_table`    |
| Add foreign keys | `add_foreign_keys_to_<table>_table` | `node ace make:migration add_foreign_keys_to_users_table` |
| Remove column    | `remove_<col>_from_<table>_table`   | `node ace make:migration remove_bio_from_users_table`     |

Table names are always **plural snake_case**: `users`, `artist_types`,
`hair_colors`.

## Migration Structure

### Create table

```typescript
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.text('description').nullable()
      table.boolean('active').defaultTo(true).notNullable()
      table.enum('status', ['draft', 'published', 'archived']).defaultTo('draft').notNullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

### Alter table (add foreign keys)

```typescript
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.foreign('role_id').references('id').inTable('roles').onDelete('SET NULL')
      table.foreign('gender_id').references('id').inTable('genders').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropForeign(['role_id'])
      table.dropForeign(['gender_id'])
    })
  }
}
```

## Column Types Reference

| Type              | Method                             | Example           |
| :---------------- | :--------------------------------- | :---------------- |
| Auto-increment PK | `table.increments('id')`           | Primary key       |
| String            | `table.string('name')`             | Up to 255 chars   |
| Text              | `table.text('bio')`                | Unlimited text    |
| Integer           | `table.integer('age')`             | Whole numbers     |
| Boolean           | `table.boolean('active')`          | true/false        |
| Enum              | `table.enum('status', ['a', 'b'])` | Fixed values      |
| Timestamp         | `table.timestamp('created_at')`    | Date + time       |
| Date              | `table.date('birthdate')`          | Date only         |
| Decimal           | `table.decimal('price', 10, 2)`    | Precision numbers |
| JSON              | `table.json('metadata')`           | JSON column       |

## Foreign Key Patterns

### Inline FK (when creating the table)

```typescript
table
  .integer('user_id')
  .unsigned()
  .notNullable()
  .references('id')
  .inTable('users')
  .onDelete('CASCADE')
```

### Nullable FK

```typescript
table
  .integer('category_id')
  .unsigned()
  .nullable()
  .references('id')
  .inTable('categories')
  .onDelete('SET NULL')
```

### Separate alter migration (when the referenced table was created later)

```typescript
this.schema.alterTable(this.tableName, (table) => {
  table.foreign('artist_type_id').references('id').inTable('artist_types').onDelete('SET NULL')
})
```

### `onDelete` strategies

| Strategy   | When                                                              |
| :--------- | :---------------------------------------------------------------- |
| `CASCADE`  | Child row must be deleted with parent (e.g., user → user's media) |
| `SET NULL` | Optional FK — set to null when parent is deleted                  |
| `RESTRICT` | Prevent parent deletion if children exist                         |

## Rules

1. **`down()` must always reverse `up()`** — `createTable` → `dropTable`,
   `alterTable` adding FK → `alterTable` dropping FK
2. **Table order matters** — reference tables (`roles`, `genders`) must be
   created before tables that depend on them
3. **Always use `.unsigned()`** on integer foreign keys
4. **Timestamps** — always include `created_at` and `updated_at`
5. **No data manipulation** in migrations — use seeders for data, not migrations
6. **After running** `node ace migration:run`, `database/schema.ts` is
   auto-regenerated — never edit it manually

## Running Migrations

```bash
node ace migration:run           # Run pending migrations
node ace migration:rollback      # Rollback last batch
node ace migration:status        # Show migration status
node ace migration:fresh         # Drop all + re-migrate (dev only!)
```

## Checklist

- [ ] Migration created via `node ace make:migration`
- [ ] Table/column names use **snake_case** plural
- [ ] `down()` reverses `up()` cleanly
- [ ] Foreign keys use `.unsigned()` and specify `.onDelete()`
- [ ] Reference tables migrate before dependent tables
- [ ] `created_at` and `updated_at` timestamps included
- [ ] No business logic or data manipulation in the migration
- [ ] Tested with `node ace migration:run` + `node ace migration:rollback`
- [ ] `database/schema.ts` regenerated after migration run
