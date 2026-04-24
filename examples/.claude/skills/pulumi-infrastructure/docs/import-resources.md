# Importing Existing GCP Resources into Pulumi

## Why Import

When adopting Pulumi on an existing project, you don't want to recreate resources. `pulumi import` copies the live resource state into Pulumi without modifying anything in GCP.

## Import Command Syntax

```bash
pulumi import <resource-type> <logical-name> <gcp-resource-id>
```

- `resource-type`: Pulumi type token (e.g., `gcp:cloudrunv2/service:Service`)
- `logical-name`: what the resource is called in your Pulumi code
- `gcp-resource-id`: the full GCP resource path

## Import Cheat Sheet

| Resource              | Type Token                                   | ID Pattern                                 |
| --------------------- | -------------------------------------------- | ------------------------------------------ |
| Cloud Run Service     | `gcp:cloudrunv2/service:Service`             | `projects/P/locations/R/services/NAME`     |
| Cloud Run Job         | `gcp:cloudrunv2/job:Job`                     | `projects/P/locations/R/jobs/NAME`         |
| Storage Bucket        | `gcp:storage/bucket:Bucket`                  | `BUCKET-NAME`                              |
| Artifact Registry     | `gcp:artifactregistry/repository:Repository` | `projects/P/locations/R/repositories/NAME` |
| Cloud Build Trigger   | `gcp:cloudbuild/trigger:Trigger`             | `projects/P/locations/R/triggers/UUID`     |
| Secret Manager Secret | `gcp:secretmanager/secret:Secret`            | `projects/P/secrets/NAME`                  |
| Cloud Scheduler Job   | `gcp:cloudscheduler/job:Job`                 | `projects/P/locations/R/jobs/NAME`         |
| Cloud SQL Instance    | `gcp:sql/databaseInstance:DatabaseInstance`  | `PROJECT/INSTANCE_NAME`                    |
| VPC Connector         | `gcp:vpcaccess/connector:Connector`          | `projects/P/locations/R/connectors/NAME`   |

## Discovery Commands

Find GCP resource IDs before importing:

```bash
# Cloud Run
gcloud run services list --region=europe-west1 --format="table(name)"
gcloud run jobs list --region=europe-west1 --format="table(name)"

# Artifact Registry
gcloud artifacts repositories list --location=europe-west1 --format="table(name)"

# Cloud Build Triggers (need the UUID)
gcloud builds triggers list --region=europe-west1 --format="json(name,id)"

# Storage
gcloud storage buckets list --format="table(name)"

# Secret Manager
gcloud secrets list --format="table(name)"

# Cloud Scheduler
gcloud scheduler jobs list --location=europe-west1 --format="table(name)"
```

## Post-Import Workflow

1. **Import**: `pulumi import <type> <name> <id> --yes`
2. **Read the generated code**: Pulumi outputs TypeScript matching the live resource
3. **Update your resource file** to match the generated code
4. **Preview**: `pulumi preview` — goal is zero diff
5. **Iterate**: fix any remaining diffs, repeat preview
6. **Commit**: once zero-diff, the code matches the live state

## Important Notes

- Imported resources get `protect: true` by default (prevents accidental deletion)
- Import is **read-only** — it never modifies the GCP resource
- After import, `pulumi preview` will show diffs where your code doesn't match the live config
- Reconcile these diffs by updating your TypeScript code, NOT by running `pulumi up` (which would modify the live resource)
- Properties like `client`, `clientVersion` are GCP metadata — they show as diffs but are harmless and resolve on next deploy
