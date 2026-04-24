# Models

📖 **Documentation:**
[`database-and-models.md`](https://docs.adonisjs.com/tutorial/hypermedia/database-and-models.md)

## Quick Start

```bash
bash .claude/skills/adonisjs-v7/scripts/create_model.sh <ModelName>
```

Or manually:

```bash
node ace make:model <ModelName>
```

> **Tip:** Use `node ace make:migration <table> -m` to create both the migration
> and model at once. After running the migration, `database/schema.ts` will be
> regenerated with column definitions.

## 🚨 CRITICAL: Auto-Generated Schema

> **⚠️ In AdonisJS v7, column definitions (`@column()` decorators) are NOT
> written manually in the model file.** They are auto-generated in
> `database/schema.ts` when you run `node ace migration:run`.

**The flow is:**

```
1. Create migration   →  defines DB columns
2. Run migration      →  auto-generates database/schema.ts (DO NOT EDIT)
3. Model extends      →  the Schema class from database/schema.ts
4. Model adds         →  relationships, getters, and mixins ONLY
```

**Never manually add `@column()` decorators in a model file.** They belong in
`database/schema.ts` which is managed automatically.

## Model Structure

### Minimal model (most common)

For models that only need database columns and no extra logic:

```typescript
// app/models/role.ts
import { RoleSchema } from '#database/schema'

export default class Role extends RoleSchema {}
```

That's it — all columns (`id`, `name`, `createdAt`, `updatedAt`) come from
`RoleSchema` in `database/schema.ts`.

### Model with relationships

```typescript
// app/models/media.ts
import { MediaSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class Media extends MediaSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
```

### Model with computed properties (getters)

```typescript
// app/models/user.ts
import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  get fullName() {
    return `${this.firstName} ${this.lastName}`
  }

  get initials() {
    if (this.firstName && this.lastName) {
      return `${this.firstName.charAt(0)}${this.lastName.charAt(0)}`.toUpperCase()
    }
    return `${this.firstName.slice(0, 2)}`.toUpperCase()
  }
}
```

## What Goes Where

| What                               | Where                                     | Example                                 |
| :--------------------------------- | :---------------------------------------- | :-------------------------------------- |
| Column definitions (`@column()`)   | `database/schema.ts` (**auto-generated**) | `declare email: string`                 |
| Relationships (`@belongsTo`, etc.) | `app/models/<model>.ts`                   | `declare role: BelongsTo<typeof Role>`  |
| Computed properties (getters)      | `app/models/<model>.ts`                   | `get fullName()`                        |
| Auth mixins                        | `app/models/<model>.ts`                   | `compose(Schema, withAuthFinder(hash))` |
| Hooks (`@beforeSave`, etc.)        | `app/models/<model>.ts`                   | `@beforeSave() static async hash(...)`  |

## Relationship Decorators

| Decorator                  | Import type                | Example              |
| :------------------------- | :------------------------- | :------------------- |
| `@belongsTo(() => Parent)` | `BelongsTo<typeof Parent>` | User belongs to Role |
| `@hasMany(() => Child)`    | `HasMany<typeof Child>`    | User has many Media  |
| `@hasOne(() => Child)`     | `HasOne<typeof Child>`     | User has one Profile |
| `@manyToMany(() => Other)` | `ManyToMany<typeof Other>` | User has many Tags   |

Always import relationship types from `@adonisjs/lucid/types/relations`:

```typescript
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
```

## Naming Conventions

| Item         | Convention                            | Example                          |
| :----------- | :------------------------------------ | :------------------------------- |
| Model class  | **PascalCase singular**               | `User`, `ArtistType`             |
| Schema class | **PascalCase + Schema**               | `UserSchema`, `ArtistTypeSchema` |
| Table name   | **snake_case plural** (auto-inferred) | `users`, `artist_types`          |
| FK property  | `<relation>Id` (camelCase)            | `roleId`, `genderId`             |

## Checklist

- [ ] Model created via `node ace make:model`
- [ ] Model extends the auto-generated `Schema` class from `#database/schema`
- [ ] **No `@column()` decorators** in the model file — they are in schema.ts
- [ ] Migration run to regenerate `database/schema.ts`
- [ ] Relationships use correct decorators and type imports
- [ ] Computed properties are plain getters (no decorator needed)
- [ ] Uses `#models/*` import alias
