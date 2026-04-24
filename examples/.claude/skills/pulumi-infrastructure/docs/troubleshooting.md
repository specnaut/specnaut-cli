# Troubleshooting — Common Pulumi + GCP Errors

## Cloud SQL

### "Knex: Timeout acquiring a connection. The pool is probably full."

**Cause**: Cloud Run cannot reach Cloud SQL. Usually a networking issue.

**Solutions (in order)**:

1. Verify Cloud SQL has a **private IP** (not just public)
2. Verify Cloud Run has a **VPC Connector** configured
3. Verify the **Private Service Access** VPC peering exists
4. Verify `DB_HOST` is the **private IP** (e.g., `10.46.0.3`), not a socket path
5. Check that the database user and password are correct

### "DB_HOST must be a valid (domain or ip)"

**Cause**: Framework validation rejects Unix socket paths like `/cloudsql/project:region:instance`. AdonisJS, Rails, and other frameworks with env validation will fail on socket paths.

**Solution**: Use the Cloud SQL **private IP address** instead of the socket path. Cloud Run connects via VPC Connector, so the private IP is routable.

```typescript
// WRONG — socket path fails framework validation
{ name: 'DB_HOST', value: '/cloudsql/project:region:instance' }

// CORRECT — use private IP
{ name: 'DB_HOST', value: pulumi.interpolate`${dbInstance.privateIpAddress}` }
```

### Cloud SQL public IP unreachable from Cloud Run

**Cause**: Cloud SQL public IP requires "Authorized Networks" — but Cloud Run has no fixed outbound IP. Connections are blocked.

**Solution**: Always use **private IP**. This requires:

1. VPC Connector on Cloud Run
2. Private Service Access (VPC peering) for Cloud SQL
3. `ipv4Enabled: false` on the Cloud SQL instance

Never use public IP for Cloud Run → Cloud SQL connectivity.

### Cloud SQL instance creation takes 10-15 minutes

This is normal. Network config changes (public → private IP) take 15-20 minutes. Be patient and monitor via the Pulumi live dashboard.

### Cloud SQL `dependsOn` is mandatory

Cloud SQL with private IP will fail to create if the VPC peering isn't ready:

```typescript
// WRONG — may fail with "network not found"
new gcp.sql.DatabaseInstance('db', { ... })

// CORRECT — wait for peering
new gcp.sql.DatabaseInstance('db', { ... }, { dependsOn: [privateConnection] })
```

## Secret Manager

### "Secret not found" when Cloud Run starts

**Cause**: The secret exists but the Cloud Run service account doesn't have `secretAccessor` permission. OR the IAM binding was just created and hasn't propagated yet (~5-10 seconds).

**Solution**: Add an IAM binding for each secret AND retry if first deploy fails:

```typescript
new gcp.secretmanager.SecretIamMember('secret-accessor', {
  secretId: secret.id,
  role: 'roles/secretmanager.secretAccessor',
  member: `serviceAccount:${computeServiceAccount}`,
})
```

**IMPORTANT**: IAM bindings take ~5-10 seconds to propagate. If `pulumi up` creates a secret + IAM binding + Cloud Run update in the same operation, the Cloud Run update may fail because it tries to access the secret before the IAM binding is active. **Solution: run `pulumi up` again** — the second run succeeds because the IAM is now propagated.

### "Missing environment variable" in AdonisJS

**Cause**: AdonisJS validates env vars at boot via `start/env.ts`. If a required var is missing, the container exits immediately with exit code 1.

**Solution**: Ensure ALL required env vars are defined in the Cloud Run container spec. Check `start/env.ts` for the complete list. Common forgotten vars: `LOG_LEVEL`, `APP_URL`, `SCHEDULER_SECRET`, `REDIS_HOST`, `REDIS_PORT`.

## Cloud Build Trigger

### "Error 403: failed to get service account gaia id"

**Cause**: The Pulumi GCP provider (which wraps Terraform) doesn't fully support 2nd gen Cloud Build triggers using Developer Connect (`developerConnectEventConfig`). It tries to update the trigger using the old API format.

**Solution**: Manage the trigger outside Pulumi:

1. Create/modify the trigger via GCP Console or `gcloud`
2. In Pulumi, only reference the trigger name as a constant

```typescript
// Don't manage the trigger in Pulumi
export const triggerName = 'my-trigger-name'
```

Do NOT use `ignoreChanges` — Pulumi still validates the resource schema and will fail if required fields like `repositoryEventConfig` are in the ignore list.

### "Precondition check failed" (Error 400)

**Cause**: Attempting to modify a 2nd gen trigger field that the provider doesn't handle correctly.

**Solution**: Same as above — manage outside Pulumi.

### "The user is forbidden from accessing the bucket [project_cloudbuild]"

**Cause**: The service account used in GitHub Actions doesn't have Cloud Build or Storage permissions. Cloud Build needs a staging bucket to upload sources.

**Solution**: Grant the following roles to the GitHub Actions service account:

```bash
gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor" \
  --condition=None --quiet

gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.admin" \
  --condition=None --quiet

gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer" \
  --condition=None --quiet
```

### "gcloud builds submit" log streaming fails

**Cause**: The service account can submit builds but can't stream logs from the default logs bucket (VPC-SC or permissions).

**Solution**: Use `--async` and poll the build status:

```bash
BUILD_ID=$(gcloud builds submit . --tag IMAGE --region REGION --async --format="value(id)" --quiet)
gcloud builds log --stream "$BUILD_ID" --region REGION 2>/dev/null || true
STATUS=$(gcloud builds describe "$BUILD_ID" --region REGION --format="value(status)")
if [ "$STATUS" != "SUCCESS" ]; then exit 1; fi
```

## Cloud Run

### "Container failed to start and listen on the port"

**Cause**: The container crashes before it can listen on the port. Check logs:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE"' \
  --limit=20 --format="value(textPayload)" --freshness=10m
```

**Common sub-causes**:

- Missing env vars (AdonisJS validation fails)
- Database connection error (wrong host, missing VPC connector)
- Secret not accessible (missing IAM binding)
- Out of memory (increase `memory` limit)

### "PORT" is a reserved environment variable

**Cause**: Cloud Run injects `PORT` automatically. Setting it manually via `--set-env-vars` causes: "The following reserved env names were provided: PORT."

**Solution**: Never set `PORT` in env vars. Cloud Run sets it to `8080` by default. Your app should read the `PORT` env var (AdonisJS does this automatically).

### `--update-env-vars` on Cloud Run Jobs is destructive

**Cause**: `gcloud run jobs execute --update-env-vars` permanently modifies the job definition, not just the current execution. If you use it to override `DB_DATABASE` for a preview, the production job is now pointing to the wrong database.

**Solution**: For preview/ephemeral environments, create a **separate job**:

```bash
# Create ephemeral job
gcloud run jobs create my-job-pr-123 --image IMAGE --set-env-vars "DB_DATABASE=my_pr_123" ...

# Execute it
gcloud run jobs execute my-job-pr-123 --wait

# Cleanup
gcloud run jobs delete my-job-pr-123 --quiet
```

Never share the production job with preview environments.

### "PERMISSION_DENIED" on `pulumi up`

**Cause**: Your gcloud credentials don't have the required roles.

**Solution**: Ensure your account has at minimum:

- `roles/run.admin`
- `roles/iam.serviceAccountUser`
- `roles/secretmanager.admin`
- `roles/cloudsql.admin`
- `roles/storage.admin`

## Pulumi General

### "no current project found"

**Cause**: Running Pulumi commands outside the `infrastructure/` directory.

**Solution**: Always `cd infrastructure` first, or pass `--cwd infrastructure`.

### Tree-shaking removes resources

**Cause**: Pulumi uses TypeScript's import system. If a resource is imported but the variable isn't referenced, it may be tree-shaken and the resource won't be created.

**Solution**: Reference all resources in `index.ts` outputs:

```typescript
// Ensure all resources are registered
export const schedulerJobs = [job1.name, job2.name]
```

### "protect: true" blocks state deletion

**Cause**: Imported resources are marked `protect: true` by default.

**Solution**: Use `--force` flag:

```bash
pulumi state delete 'urn:pulumi:...' --force
```

### IAM policy binding requires `--condition=None`

**Cause**: When a GCP project has conditional IAM policies, `gcloud projects add-iam-policy-binding` fails in non-interactive mode without `--condition=None`.

**Solution**: Always add `--condition=None`:

```bash
gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:SA" \
  --role="roles/some.role" \
  --condition=None --quiet
```

## Cloud Storage / GCS

### "Permission 'iam.serviceAccounts.signBlob' denied" when generating signed URLs

**Cause**: The Cloud Run compute service account needs `roles/iam.serviceAccountTokenCreator` to sign blobs for GCS signed URLs. Without this, `drive.use().getSignedUrl()` throws a 500.

**Solution**:

```bash
gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None --quiet
```

This is in addition to `roles/storage.objectAdmin` on the bucket itself.

### "Cannot generate URL for file at location" crashes the controller

**Cause**: `getSignedUrl()` throws if the file doesn't exist in the bucket or if permissions are wrong. An unhandled exception in an async `.map()` crashes the entire request with 500.

**Solution**: Wrap `getSignedUrl()` in a try/catch and return `null` on failure:

```typescript
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

### `@adonisjs/drive-gcs` is NOT compatible with AdonisJS v7

**Cause**: `@adonisjs/drive-gcs@1.x` requires `@adonisjs/core@^5.0.0`. AdonisJS v7 uses `@adonisjs/drive` which bundles `flydrive` with a built-in GCS driver.

**Solution**: Do NOT install `@adonisjs/drive-gcs`. Instead:

```bash
# Install only the GCS SDK (peer dependency of flydrive)
npm install @google-cloud/storage
```

The driver is already in `@adonisjs/drive` → `flydrive` → `flydrive/drivers/gcs`. Configure in `config/drive.ts`:

```typescript
import { services } from '@adonisjs/drive'

gcs: services.gcs({
  bucket: env.get('GCS_BUCKET') ?? '',
  usingUniformAcl: true,
  visibility: 'private',
})
```

### Changing DRIVE_DISK before deploying new image crashes Cloud Run

**Cause**: If you switch `DRIVE_DISK=gcs` via Pulumi before deploying a new Docker image that includes `@google-cloud/storage`, the existing container doesn't have the GCS SDK and fails to start.

**Solution**: Deploy the new image FIRST (via Cloud Build / git tag), THEN switch `DRIVE_DISK=gcs` via `pulumi up`. Or keep `DRIVE_DISK=fs` in Pulumi and switch after the deploy.

### IAM roles required for GCS with Cloud Run

The compute service account needs TWO roles:

| Role | Purpose |
|---|---|
| `roles/storage.objectAdmin` | Read/write objects in the bucket |
| `roles/iam.serviceAccountTokenCreator` | Sign blobs for signed URLs |

Both must be granted — `objectAdmin` alone is NOT enough for signed URLs.

## GCP API Not Enabled

### "API has not been used in project before or it is disabled"

**Cause**: The required GCP API hasn't been enabled.

**Solution**: Enable all required APIs at once:

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  cloudscheduler.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project=PROJECT
```

## GitHub Actions + GCP

### Service account roles for GitHub Actions

The GitHub Actions service account needs these roles for the full CI/CD pipeline:

| Role | Purpose |
|---|---|
| `roles/cloudbuild.builds.editor` | Submit builds |
| `roles/cloudbuild.builds.viewer` | Stream build logs |
| `roles/storage.admin` | Access Cloud Build staging bucket |
| `roles/serviceusage.serviceUsageConsumer` | Use GCP APIs |
| `roles/logging.logWriter` | Write build logs |
| `roles/cloudsql.admin` | Create/delete PR databases |
| `roles/run.admin` | Deploy Cloud Run services and jobs |
| `roles/iam.serviceAccountUser` | Act as service accounts |
| `roles/secretmanager.secretAccessor` | Read secrets for Cloud Run |
| `roles/iam.serviceAccountTokenCreator` | Sign blobs for GCS signed URLs |
