# Preview Environments — Ephemeral Per-PR Infrastructure

## Architecture

Each PR gets its own isolated environment:

```
PR #123 creates:
  Cloud Run Service:  myapp-pr-123        (scales to zero, ~$0)
  Cloud Run Job:      myapp-migrate-pr-123 (ephemeral, deleted after use)
  Cloud SQL Database: myapp_pr_123         (on shared instance, ~$0)
  Docker Image:       myapp:pr-123         (in Artifact Registry)

PR closed → cleanup.yml deletes all four resources
```

## Key Design Decisions

### Shared Cloud SQL Instance, Separate Databases

Do NOT create a Cloud SQL instance per PR ($7-10/month each, 10-15 min creation time). Instead:
- Use the **existing** production Cloud SQL instance
- Create a **database** per PR (`gcloud sql databases create myapp_pr_123`)
- Database creation takes seconds, costs nothing extra

### Ephemeral Jobs, NOT Shared Jobs

**CRITICAL**: Never use `--update-env-vars` on a shared Cloud Run Job to override `DB_DATABASE`. This permanently modifies the job definition, corrupting the production job.

Instead, create a **separate job per PR**:

```bash
# Create
gcloud run jobs create myapp-migrate-pr-123 --image IMAGE --set-env-vars "DB_DATABASE=myapp_pr_123,..." --quiet

# Execute
gcloud run jobs execute myapp-migrate-pr-123 --wait --quiet

# Cleanup (on PR close)
gcloud run jobs delete myapp-migrate-pr-123 --quiet
```

### Use `delete + create` for Jobs, NOT `create || update`

Cloud Run Jobs don't have an upsert command like `gcloud run deploy` (which is idempotent for services). For jobs on repeated PR syncs:

```bash
# Delete existing (silent if not found)
gcloud run jobs delete myapp-migrate-pr-123 --quiet 2>/dev/null || true

# Create fresh with latest image and config
gcloud run jobs create myapp-migrate-pr-123 --image IMAGE ...

# Execute
gcloud run jobs execute myapp-migrate-pr-123 --wait
```

### Cloud Build for Docker Image (Not GitHub Actions)

Use `gcloud builds submit` instead of `docker build + docker push`:
- Build runs on GCP (same network as Artifact Registry = fast push)
- No Docker-in-Docker needed on GitHub runners
- No GitHub Actions minutes consumed for Docker build

```bash
BUILD_ID=$(gcloud builds submit . --tag IMAGE --region REGION --async --format="value(id)" --quiet)
# Poll status (log streaming may fail due to permissions)
gcloud builds log --stream "$BUILD_ID" --region REGION 2>/dev/null || true
STATUS=$(gcloud builds describe "$BUILD_ID" --region REGION --format="value(status)")
if [ "$STATUS" != "SUCCESS" ]; then exit 1; fi
```

### `PORT` is Reserved

Never set `PORT` in Cloud Run Job env vars. Cloud Run injects it automatically. Setting it causes: "The following reserved env names were provided: PORT."

## Environment Variables Checklist

Ensure ALL required env vars are set on the ephemeral job. Common ones forgotten:

- `LOG_LEVEL` — app crashes at boot without it
- `APP_URL` — needed for URL generation
- `SCHEDULER_SECRET` — needed if middleware validates it at boot
- `REDIS_HOST` / `REDIS_PORT` — if the app requires Redis at startup
- `PORT` — **do NOT set this**, Cloud Run handles it

## Cleanup Workflow

The cleanup must be **idempotent** (running twice is safe) and use `continue-on-error: true` on each step:

```yaml
- name: Delete Cloud Run service
  continue-on-error: true
  run: gcloud run services delete myapp-pr-${{ github.event.number }} --region REGION --quiet

- name: Delete migration job
  continue-on-error: true
  run: gcloud run jobs delete myapp-migrate-pr-${{ github.event.number }} --region REGION --quiet

- name: Delete database
  continue-on-error: true
  run: gcloud sql databases delete myapp_pr_${{ github.event.number }} --instance=INSTANCE --quiet

- name: Delete Docker image
  continue-on-error: true
  run: gcloud artifacts docker images delete REGISTRY/IMAGE:pr-${{ github.event.number }} --quiet --delete-tags
```

## Cost

| Resource | Cost per PR |
|---|---|
| Cloud Run Service | ~$0 (scales to zero) |
| Cloud Run Job | ~$0 (runs once, deleted) |
| Cloud SQL Database | $0 (shared instance) |
| Docker Image | ~$0 (cleaned up) |
| **Total** | **~$0** |
