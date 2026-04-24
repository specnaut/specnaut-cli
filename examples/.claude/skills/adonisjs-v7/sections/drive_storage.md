# Drive & File Storage

📖 **Documentation:**
[`drive.md`](https://docs.adonisjs.com/guides/digging-deeper/drive)

## Overview

AdonisJS Drive provides a unified API for file storage across multiple backends (local filesystem, GCS, S3). The project uses `@adonisjs/drive` with `flydrive` under the hood.

## Configuration

### `config/drive.ts`

```typescript
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, services } from '@adonisjs/drive'

const driveConfig = defineConfig({
  default: env.get('DRIVE_DISK'),

  services: {
    fs: services.fs({
      location: app.makePath('storage'),
      serveFiles: true,
      routeBasePath: '/uploads',
      visibility: 'public',
    }),

    gcs: services.gcs({
      bucket: env.get('GCS_BUCKET') ?? '',
      usingUniformAcl: true,
      visibility: 'private',
    }),
  },
})
```

### Environment Variables

```typescript
// start/env.ts
DRIVE_DISK: Env.schema.enum(['fs', 'gcs'] as const),
GCS_BUCKET: Env.schema.string.optional(),
```

| Environment | `DRIVE_DISK` | `GCS_BUCKET` | Notes |
|---|---|---|---|
| Local dev | `fs` | not set | Files in `storage/`, served at `/uploads/` |
| Production | `gcs` | `miximodel-media` | Signed URLs, private bucket |
| Preview | `gcs` | `miximodel-media` | Shared bucket with production |
| CI/Tests | `fs` | not set | Local filesystem, no credentials needed |

## Key Rules

### 1. NEVER use `drive.use('fs')` — always use `drive.use()`

```typescript
// WRONG — hardcodes the filesystem driver
await drive.use('fs').put(path, buffer)

// CORRECT — uses the default driver from DRIVE_DISK env var
await drive.use().put(path, buffer)
```

### 2. NEVER hardcode `/uploads/` in URLs

```typescript
// WRONG — breaks in production (GCS doesn't serve at /uploads/)
const url = `/uploads/${user.avatar}`

// CORRECT — use the storageUrl helper
import { storageUrl } from '#helpers/storage_url'
const url = await storageUrl(user.avatar)
```

### 3. Process images in-memory, not on disk

Cloud Run has an ephemeral filesystem. Never save a file locally, process it, then upload. Instead:

```typescript
// WRONG — saves to local disk, then reads back
await file.moveToDisk(path)
const fullPath = this.getFullPath(path) // local path
const metadata = await sharp(fullPath).metadata() // reads from disk

// CORRECT — read buffer from temp upload, process in memory
const buffer = await readFile(file.tmpPath!)
const metadata = await sharp(buffer).metadata()
await drive.use().put(path, processedBuffer) // upload to GCS/fs
```

### 4. Use signed URLs for private files (GCS)

The bucket has `publicAccessPrevention: enforced`. Files are NOT publicly accessible. Generate time-limited signed URLs:

```typescript
// Backend helper — app/helpers/storage_url.ts
export async function storageUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  if (env.get('DRIVE_DISK') === 'fs') return `/uploads/${path}`
  try {
    return await drive.use().getSignedUrl(path, { expiresIn: '1h' })
  } catch {
    logger.warn({ path }, 'Failed to generate signed URL')
    return null
  }
}
```

The try/catch is mandatory — `getSignedUrl()` throws if:
- The file doesn't exist in the bucket
- The service account lacks `iam.serviceAccounts.signBlob` permission
- The bucket is misconfigured

### 5. Frontend helper for URL safety

```typescript
// inertia/helpers/storage_url.ts
export function storageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path // already a signed URL from backend
  return `/uploads/${path}` // fallback for dev
}
```

The frontend helper is sync and handles:
- `null`/`undefined` → returns `undefined`
- Already-resolved signed URLs (start with `http`) → pass through
- Raw paths → prefix with `/uploads/` (dev mode fallback)

## GCS Setup (for new projects)

### 1. Install the GCS SDK (NOT `@adonisjs/drive-gcs`)

```bash
# CORRECT — peer dependency for flydrive's GCS driver
npm install @google-cloud/storage

# WRONG — this is for AdonisJS v5, NOT v7
# npm install @adonisjs/drive-gcs  ← DO NOT USE
```

### 2. IAM roles for Cloud Run service account

| Role | Purpose |
|---|---|
| `roles/storage.objectAdmin` | Read/write objects in the bucket |
| `roles/iam.serviceAccountTokenCreator` | Sign blobs for signed URLs |

Both are required. `objectAdmin` alone does NOT allow generating signed URLs.

### 3. Authentication

On Cloud Run, authentication is automatic via Application Default Credentials (ADC). No API key or JSON keyfile needed. Just ensure the IAM roles are set.

In local dev, `DRIVE_DISK=fs` bypasses GCS entirely — no credentials needed.

## File Upload Pattern

The standard pattern for processing an uploaded file:

```typescript
import { MultipartFile } from '@adonisjs/core/bodyparser'
import drive from '@adonisjs/drive/services/main'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

async function processUpload(file: MultipartFile, folder: string) {
  const uuid = randomUUID()
  const ext = file.extname || 'jpg'
  const filePath = `${folder}/${uuid}.${ext}`

  // 1. Read from temp upload into buffer
  const buffer = await readFile(file.tmpPath!)

  // 2. Process with sharp (resize, thumbnail, etc.)
  const processed = await sharp(buffer)
    .resize(1200, undefined, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  // 3. Upload to drive (fs or gcs depending on DRIVE_DISK)
  await drive.use().put(filePath, processed)

  return filePath // store this relative path in the database
}
```

## Copying Files Between Paths

When copying files (e.g., duplicating a gallery photo), read from drive and write back:

```typescript
async function copyFile(sourcePath: string, destFolder: string): string {
  const ext = sourcePath.split('.').pop() || 'jpg'
  const destPath = `${destFolder}/${randomUUID()}.${ext}`

  // Read from drive (works with both fs and gcs)
  const stream = await drive.use().getStream(sourcePath)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  await drive.use().put(destPath, Buffer.concat(chunks))

  return destPath
}
```

## Deleting Files

```typescript
async function deleteFile(path: string): Promise<void> {
  try {
    await drive.use().delete(path)
  } catch {
    // Silently ignore — file may already be deleted
  }
}
```

## Seeders & Drive

Seeders that create files (avatars, blog images, gallery photos) MUST use `drive.use()` — not `fs.copyFile` or `drive.use('fs')`. Otherwise, files go to the ephemeral local filesystem and disappear on Cloud Run.

### Pattern: Upload a bundled asset during seeding

```typescript
// database/seeders/my_seeder.ts
import fs from 'node:fs/promises'
import app from '@adonisjs/core/services/app'

// Dynamic import — drive isn't available at module load time in seeders
const driveModule = await import('@adonisjs/drive/services/main')
const drive = driveModule.default

// Read the bundled asset file
const source = app.makePath('database/seeders/assets/my_image.png')
const buffer = await fs.readFile(source)

// Upload via drive (goes to GCS in prod, storage/ in dev)
await drive.use().put('my_image.png', buffer)
```

### Key rules for seeders

1. **Use `drive.use()`** — never `drive.use('fs')` or `fs.copyFile`
2. **Dynamic import** — use `await import('@adonisjs/drive/services/main')` in seeders (the drive service may not be available at module load time)
3. **Don't access `.default` directly from `await`** — ESLint rule `@unicorn/no-await-expression-member` forbids `(await import(...)).default`. Split into two lines.
4. **Never write to `public/uploads/`** — that directory is for the `fs` driver's route handler. Use `drive.use().put()` instead.
5. **Use in-memory buffers** — if the seeder processes images (e.g., face detection with sharp), pass the buffer directly, don't read back from the local filesystem after uploading.

## Common Mistakes

| Mistake | Fix |
|---|---|
| `npm install @adonisjs/drive-gcs` | Use `npm install @google-cloud/storage` instead (v7 compat) |
| `drive.use('fs').put(...)` | `drive.use().put(...)` — respect DRIVE_DISK |
| `` `/uploads/${path}` `` in backend | `await storageUrl(path)` |
| `` `/uploads/${path}` `` in frontend | `storageUrl(path)` (from helper) |
| `sharp(localFilePath)` on Cloud Run | `sharp(buffer)` — process in memory |
| `file.moveToDisk(path)` then `sharp(localPath)` | Read buffer first, process, then `drive.put()` |
| Missing `serviceAccountTokenCreator` role | Signed URLs fail with 500 — need both `objectAdmin` + `tokenCreator` |
| `getSignedUrl()` without try/catch | Crashes entire request if file missing — always wrap |
| `fs.copyFile` in seeders | Use `drive.use().put()` — files must go to GCS in prod |
| `(await import(...)).default` | Split: `const mod = await import(...)` then `mod.default` (lint rule) |
| Writing to `public/uploads/` in seeders | Use `drive.use().put()` — `public/uploads/` is only for `fs` driver |
