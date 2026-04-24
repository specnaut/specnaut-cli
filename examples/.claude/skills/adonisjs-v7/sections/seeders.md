# Seeders

📖 **Documentation:**
[`database-and-models.md`](https://docs.adonisjs.com/tutorial/react/database-and-models.md)

## Quick Start

```bash
bash .claude/skills/adonisjs-v7/scripts/create_seeder.sh <Name>
```

Or manually:

```bash
node ace make:seeder <Name>
```

## Architecture — Main Seeder Pattern

### Problem: double execution

By default, `node ace db:seed` auto-discovers and runs **every** seeder file in
the configured seeders directory. If you have a `main_seeder.ts` that
orchestrates child seeders via `import()`, each child seeder runs **twice** —
once from the orchestrator, once from auto-discovery. This causes duplicate data
and duplicate log messages.

### Solution: isolate the main seeder

Move the `main_seeder.ts` into its own subdirectory (e.g.
`database/seeders/main/`) and configure `seeders.paths` in `config/database.ts`
to only scan that directory. The child seeders remain in `database/seeders/` but
are never auto-discovered.

**Step 1 — Directory structure:**

```
database/seeders/
├── main/
│   └── main_seeder.ts     ← Only file auto-discovered by db:seed
├── role_seeder.ts          ← Child seeders (NOT auto-discovered)
├── user_seeder.ts
├── post_seeder.ts
└── ...
```

**Step 2 — Configure `config/database.ts`:**

```typescript
// config/database.ts
const dbConfig = defineConfig({
  connection: "postgres",
  connections: {
    postgres: {
      client: "pg",
      connection: {
        /* ... */
      },
      migrations: {
        naturalSort: true,
        paths: ["database/migrations"],
      },
      seeders: {
        paths: ["database/seeders/main"], // ← Only discover main_seeder
      },
    },
  },
});
```

**Step 3 — Main seeder orchestrates all children:**

```typescript
// database/seeders/main/main_seeder.ts
import { BaseSeeder } from "@adonisjs/lucid/seeders";

export default class extends BaseSeeder {
  private async runSeeder(Seeder: { default: typeof BaseSeeder }) {
    await new Seeder.default(this.client).run();
  }

  async run() {
    // 1 — Reference data (no dependencies)
    await this.runSeeder(await import("#database/seeders/role_seeder"));
    await this.runSeeder(await import("#database/seeders/gender_seeder"));

    // 2 — Users (depends on roles, genders)
    await this.runSeeder(await import("#database/seeders/user_seeder"));

    // 3 — Content (depends on users)
    await this.runSeeder(await import("#database/seeders/post_seeder"));
  }
}
```

> **Why `seeders.paths` instead of code guards?** Adding `static invokedByMain`
> flags to every child seeder is fragile and verbose. The `seeders.paths` config
> is a one-line, framework-native solution that solves the problem at the root.

## Seeder Patterns

### Simple lookup data

For tables with fixed values (roles, categories, statuses):

```typescript
// database/seeders/role_seeder.ts
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import Role from "#models/role";

export default class extends BaseSeeder {
  async run() {
    await Role.createMany([
      { name: "Model" },
      { name: "Photographer" },
      { name: "Makeup Artist" },
      { name: "Agency" },
    ]);
  }
}
```

### Idempotent seeder (safe to re-run)

Use `updateOrCreateMany` for lookup data:

```typescript
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import Role from "#models/role";

export default class extends BaseSeeder {
  async run() {
    await Role.updateOrCreateMany("name", [
      { name: "Model" },
      { name: "Photographer" },
      { name: "Makeup Artist" },
      { name: "Agency" },
    ]);
  }
}
```

### Fake data with Faker

For generating realistic test data:

```typescript
// database/seeders/user_seeder.ts
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import User from "#models/user";
import { faker } from "@faker-js/faker";
import { DateTime } from "luxon";

export default class extends BaseSeeder {
  async run() {
    const users: any[] = [];

    for (let i = 0; i < 50; i++) {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();

      users.push({
        firstName,
        lastName,
        username: faker.internet.username({ firstName, lastName })
          .toLowerCase(),
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        password: "password",
        birthdate: DateTime.fromJSDate(
          faker.date.birthdate({ min: 18, max: 65, mode: "age" }),
        ),
        lastLoggedIn: DateTime.now(),
      });
    }

    await User.createMany(users);
  }
}
```

## Performance Optimizations

### Pre-hash passwords for bulk user seeding

The `withAuthFinder` mixin adds a `beforeSave` hook that hashes the password on
every `create()` / `updateOrCreate()` call. With scrypt (cost 16384), each hash
takes ~100ms. Seeding 500 users = **~50 seconds** wasted on hashing the same
password.

**Solution:** Hash the password once, then use raw `db.table().multiInsert()` to
bypass the model hook entirely.

```typescript
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import hash from "@adonisjs/core/services/hash";
import db from "@adonisjs/lucid/services/db";
import { faker } from "@faker-js/faker";
import { DateTime } from "luxon";

export default class extends BaseSeeder {
  async run() {
    // Hash once — not 500 times
    const hashedPassword = await hash.make("password");
    const now = DateTime.now();

    const users: Record<string, any>[] = [];

    for (let i = 0; i < 500; i++) {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();

      // Use snake_case keys — raw insert bypasses model's naming strategy
      users.push({
        username: faker.internet.username({ firstName, lastName })
          .toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        password: hashedPassword,
        birthdate: DateTime.fromJSDate(
          faker.date.birthdate({ min: 18, max: 65, mode: "age" }),
        ).toISO(),
        created_at: now.toISO(),
        updated_at: now.toISO(),
      });
    }

    // Batch insert — bypasses model hooks (no re-hashing)
    const BATCH_SIZE = 100;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      await db.table("users").multiInsert(users.slice(i, i + BATCH_SIZE));
    }
  }
}
```

> **⚠️ Important:** Raw inserts bypass model hooks **and** the naming strategy.
> Column names must be **snake_case** (matching the DB schema), not camelCase.
> Use this only for bulk-generated data. For fixture users that need
> idempotency, use `User.updateOrCreate()` with plain `password: 'password'` —
> the model hook handles hashing naturally (~12 users = acceptable).

### Batch database queries

Avoid N+1 queries in seeders. Load related data in bulk:

```typescript
// ❌ Bad — 40 individual queries
for (const name of cityNames) {
  const city = await City.query().where("name", name).first();
}

// ✅ Good — 1 query
const cities = await City.query().whereIn("name", cityNames);
const cityMap = new Map(cities.map((c) => [c.name, c]));
```

Similarly, prefer `Model.createMany()` over loops of `Model.create()`:

```typescript
// ❌ Bad — N insert queries
for (const item of items) {
  await Item.create(item);
}

// ✅ Good — 1 batch insert
await Item.createMany(items);
```

## Rules

1. **Main seeder in `database/seeders/main/`** — only this directory is in
   `seeders.paths` (configured in `config/database.ts`)
2. **Always register** new seeders in `database/seeders/main/main_seeder.ts`
3. **Child seeders in `database/seeders/`** — they are imported by main_seeder
   but never auto-discovered by `db:seed`
4. **Respect FK order** — seed reference tables (roles, genders) before
   dependent tables (users)
5. **Use `createMany()`** for bulk inserts — more efficient than individual
   `create()` calls
6. **Use `updateOrCreateMany()`** for lookup data that should be idempotent
7. **Pre-hash passwords** for bulk user seeding — use `db.table().multiInsert()`
   with a single pre-computed hash to avoid N × scrypt overhead
8. **Batch queries** — use `whereIn()` instead of loops of `.where().first()`
9. **Use `@faker-js/faker`** for realistic test data
10. **Use `DateTime` from luxon** for date columns — not raw JS `Date`
11. **Import alias:** `#database/seeders/*` for importing seeders in main seeder

## Running Seeders

```bash
node ace db:seed                           # Run main seeder (only)
node ace migration:fresh --seed            # Reset DB + seed
node ace db:seed --files "main_seeder"     # Explicit file selection
```

## Checklist

- [ ] Seeder created in `database/seeders/` (NOT in `main/`)
- [ ] Registered in `database/seeders/main/main_seeder.ts` in correct order
- [ ] `config/database.ts` has `seeders.paths: ['database/seeders/main']`
- [ ] FK dependencies seeded before dependent tables
- [ ] Uses `createMany()` or `db.table().multiInsert()` for bulk inserts
- [ ] Lookup data uses `updateOrCreateMany()` for idempotency
- [ ] Bulk user seeding pre-hashes password once (raw insert with snake_case
      keys)
- [ ] No N+1 queries — uses `whereIn()` for batch lookups
- [ ] Faker data is realistic and diverse
- [ ] DateTime columns use luxon's `DateTime`
