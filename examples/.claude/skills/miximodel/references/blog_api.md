# Blog API quick reference

Spec: [`specs/195-blog-api/`](../../../../specs/195-blog-api/)

## Endpoints

| Method | Path | Auth | Purpose |
| :----- | :--- | :--- | :------ |
| GET | `/api/blog` | public | paginated list of published articles |
| GET | `/api/blog/:slug` | public | single published article |
| POST | `/api/blog` | Bearer + admin | create |
| PUT | `/api/blog/:slug` | Bearer + admin | update |
| DELETE | `/api/blog/:slug` | Bearer + admin | soft-delete |
| POST | `/api/blog/media` | Bearer + admin | upload one image (returns URL) |

All admin endpoints return `401` for missing/invalid Bearer and `403` for
authenticated non-admin tokens.

## Article payload (create)

```json
{
  "title": "string (1..255)",
  "slug": "kebab-case-optional",
  "body": "markdown string (1..100000)",
  "excerpt": "short teaser (<=500, nullable)",
  "coverImage": "https://... (nullable, must be a URL)",
  "status": "draft|published",
  "publishedAt": "ISO 8601 | null"
}
```

Update uses the same shape, all fields optional, but the payload must contain
at least one field.

## Media upload

```
POST /api/blog/media
Content-Type: multipart/form-data
field: file (jpg|jpeg|png|webp, <=10 MB)

→ 201 Created
{
  "url": "https://storage.miximodel.com/blog/articles/2026/04/<uuid>.jpg",
  "size": 123456,
  "mimeType": "image/jpeg"
}
```

Magic-byte MIME detection rejects spoofed extensions (e.g., `.exe` renamed
to `.jpg`). The claimed extension must match the detected type.

## Token lifecycle

Issue:

```
node ace admin:token:issue <username|email|id> --name "miximodel-skill"
# Optional: --expires-in 365d  (default 365d)
```

The identifier is resolved as username first, then email (if it contains
`@`), then numeric id. Warns and exits non-zero on a non-admin user.

List:

```
node ace admin:token:list <username|email|id>
```

Revoke:

```
node ace admin:token:revoke <username|email|id> <token-id>
```

Tokens are hashed at rest and are shown in plaintext **only once** at
issuance.
