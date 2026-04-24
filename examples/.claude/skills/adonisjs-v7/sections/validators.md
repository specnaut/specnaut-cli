# Validators

📖 **Documentation:**
[`validation.md`](https://docs.adonisjs.com/guides/basics/validation.md)

## Basic Validator

```typescript
// app/validators/project.ts
import vine from '@vinejs/vine'

export const createProjectValidator = vine.create({
  name: vine.string().minLength(1).maxLength(255),
  description: vine.string().nullable(),
  status: vine.enum(['draft', 'published', 'archived']),
})
```

Use in a controller:

```typescript
const payload = await request.validateUsing(createProjectValidator)
```

## Shared Rules Pattern

Extract reusable validation logic into helper functions:

```typescript
// app/validators/user.ts
import vine from '@vinejs/vine'

// Shared rules — reusable across validators
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)

export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password().confirmed({
    confirmationField: 'passwordConfirmation',
  }),
})

export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})
```

## Common Rules Reference

| Rule            | Example                             | Notes                |
| :-------------- | :---------------------------------- | :------------------- |
| Required string | `vine.string()`                     | Non-empty by default |
| Optional        | `vine.string().optional()`          | Field can be missing |
| Nullable        | `vine.string().nullable()`          | Field can be `null`  |
| Email           | `vine.string().email()`             | Email format         |
| Min/Max length  | `.minLength(8).maxLength(32)`       | String length        |
| Enum            | `vine.enum(['a', 'b', 'c'])`        | Fixed values         |
| Number          | `vine.number()`                     | Numeric value        |
| Positive number | `vine.number().positive()`          | > 0                  |
| Boolean         | `vine.boolean()`                    | true/false           |
| Date            | `vine.date()`                       | Date value           |
| Unique          | `.unique({ table, column })`        | DB uniqueness check  |
| Confirmed       | `.confirmed({ confirmationField })` | Field must match     |
| Array           | `vine.array(vine.string())`         | Array of items       |
| Object          | `vine.object({})`                   | Nested object        |

## `.optional()` vs `.nullable()`

```typescript
// optional: field can be absent from the request entirely
vine.string().optional()
// → type: string | undefined

// nullable: field is present but can be null
vine.string().nullable()
// → type: string | null

// both: field can be absent OR null
vine.string().optional().nullable()
// → type: string | null | undefined
```

## Unique Rule

```typescript
// Check uniqueness in the database
vine.string().email().unique({
  table: 'users',
  column: 'email',
})

// Exclude current record during updates
vine
  .string()
  .email()
  .unique({
    table: 'users',
    column: 'email',
    whereNot: { id: userId },
  })
```

## File Organization

One file per domain, multiple exports per file:

```
app/validators/
├── user.ts         → signupValidator, loginValidator, updateProfileValidator
├── project.ts      → createProjectValidator, updateProjectValidator
├── media.ts        → uploadMediaValidator
└── contract.ts     → createContractValidator
```

## Rules

1. **Always use `vine.create()`** — not the old `schema.create()` API
2. **Extract shared rules** into helper functions (see pattern above)
3. **One file per domain** — group related validators together
4. **Name validators descriptively**: `<action><Domain>Validator`
   (`createProjectValidator`, `updateProfileValidator`)
5. **Always validate** in the controller — never skip validation

## Checklist

- [ ] Uses `vine.create()` API
- [ ] Shared rules extracted into helper functions
- [ ] Uses `.nullable()` / `.optional()` correctly
- [ ] Unique checks include table and column
- [ ] Validators grouped by domain in `app/validators/`
- [ ] Descriptive naming: `<action><Domain>Validator`
- [ ] Used in controller: `request.validateUsing(validator)`
