---
name: pulumi-infrastructure
description: Set up and manage GCP infrastructure using Pulumi with TypeScript. Use when the user asks to "create infrastructure", "add a GCP resource", "pulumi", "deploy to GCP", "add Cloud Run", "add Cloud SQL", "add Redis", or any infrastructure-as-code task.
---

# Pulumi Infrastructure — GCP with TypeScript

Set up, manage, and extend Google Cloud Platform infrastructure using Pulumi with TypeScript in a monorepo approach.

## When to Use

- Setting up a new Pulumi project for GCP
- Adding GCP resources (Cloud Run, Cloud SQL, Redis, Buckets, etc.)
- Importing existing GCP resources into Pulumi state
- Debugging infrastructure deployment issues
- Configuring networking (VPC, private IPs, service access)

## Project Structure

A Pulumi project lives in `infrastructure/` at the repository root, fully isolated from the main application tooling.

```
infrastructure/
├── Pulumi.yaml              # Project manifest (name, runtime: nodejs)
├── Pulumi.prod.yaml         # Stack config (gcp:project, gcp:region, secrets)
├── package.json             # @pulumi/pulumi, @pulumi/gcp
├── tsconfig.json            # Isolated TypeScript config (strict, ES2020)
├── index.ts                 # Entrypoint — wires all modules, exports outputs
└── resources/
    ├── cloudrun.ts          # Cloud Run Service + Job
    ├── database.ts          # Cloud SQL PostgreSQL
    ├── redis.ts             # Redis Memorystore
    ├── storage.ts           # Cloud Storage Bucket
    ├── artifact-registry.ts # Artifact Registry (Docker)
    ├── secrets.ts           # Secret Manager + IAM bindings
    ├── cloudbuild.ts        # Cloud Build Trigger
    ├── scheduler.ts         # Cloud Scheduler Jobs
    ├── network.ts           # VPC Connector + Private Service Access (PGA on default subnet)
    └── bastion.ts           # IAP-tunneled debug bastion (task 062) — see docs/ops/db-access.md
```

## Tooling Isolation (Critical)

The `infrastructure/` folder **must not** interfere with the main project. Apply these changes to the root project:

| File                             | Change                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| `eslint.config.js` (flat config) | `[{ ignores: ['infrastructure/'] }, ...configApp()]`       |
| `.prettierignore`                | Add `infrastructure/`                                      |
| `tsconfig.json`                  | Add `"infrastructure"` to `exclude` array                  |
| `.gitignore`                     | Add `infrastructure/node_modules` and `infrastructure/bin` |

## Key Concepts

### State Backend

Use **Pulumi Cloud** (free tier for individuals). Provides managed state with built-in locking and native secret encryption. Authenticate via `PULUMI_ACCESS_TOKEN` environment variable.

### Stacks

One stack per environment (e.g., `prod`, `staging`). Config values go in `Pulumi.<stack>.yaml`. Secrets are encrypted automatically with `pulumi config set --secret`.

### Resource Organization

Split resources by GCP service domain — one file per domain in `resources/`. Wire everything in `index.ts` and export stack outputs (URLs, IPs, names).

### Import vs Create

- **Existing resources**: Use `pulumi import <type> <name> <gcp-id>` to bring them into state without recreating
- **New resources**: Define in code, `pulumi up` creates them
- After import, reconcile TypeScript code to match live config (run `pulumi preview` until zero diff)

### Private Networking

Cloud Run cannot directly reach private services (Cloud SQL, Redis Memorystore). The pattern is:

1. **VPC Connector** — bridges Cloud Run to the VPC network
2. **Private Service Access** — enables Cloud SQL private IP via VPC peering
3. Cloud Run `vpcAccess.connector` + `egress: PRIVATE_RANGES_ONLY`

### Secret Management

1. Create `gcp.secretmanager.Secret` (the container)
2. Create `gcp.secretmanager.SecretVersion` (the value, from `pulumi config --secret`)
3. Create `gcp.secretmanager.SecretIamMember` (grant `secretAccessor` to compute service account)
4. Reference in Cloud Run via `envs[].valueSource.secretKeyRef`

## Procedure

When the user asks to set up or modify infrastructure:

### New Project Setup

1. Run the scaffold script: `bash .claude/skills/pulumi-infrastructure/scripts/init-project.sh`
2. Apply tooling isolation to the root project
3. Define resources in `resources/*.ts`
4. Wire in `index.ts`
5. `pulumi preview` to validate, `pulumi up` to deploy

### Adding a Resource

1. Check the examples in `.claude/skills/pulumi-infrastructure/examples/` for the resource type
2. Create or update the appropriate file in `infrastructure/resources/`
3. Import and export in `infrastructure/index.ts`
4. Run `pulumi preview` to validate
5. Run `pulumi up` to deploy

### Importing Existing Resources

1. List resources: `gcloud <service> list --region=<region> --format=json`
2. Import: `pulumi import <type> <name> <gcp-resource-id>`
3. Reconcile code to match imported state
4. Repeat `pulumi preview` until zero diff

### Common Commands

```bash
# From infrastructure/ directory
pulumi preview                    # Dry-run — show planned changes
pulumi up                         # Deploy changes
pulumi stack output               # Show all outputs
pulumi import <type> <name> <id>  # Import existing resource
pulumi config set --secret <key> <value>  # Store encrypted config
pulumi state delete <urn> --force # Remove resource from state (not from GCP)
```

## Deployment Pipeline

Pulumi is the **single source of truth** for all Cloud Run configuration (env vars, secrets, VPC, scaling, image tag).

### How Deploys Work

1. **Git tag push** triggers Cloud Build which builds and pushes the Docker image to Artifact Registry (build-only, no deploy)
2. **GitHub Release** triggers `.github/workflows/deploy.yml` which:
   - Verifies the image exists in Artifact Registry
   - Runs `pulumi config set imageTag <tag>` to update the target image
   - Runs `pulumi up` to deploy atomically (service + migration job)
   - Executes the migration job
   - Sends a Telegram notification (success/failure)

### Key Points

- `cloudbuild.yaml` does NOT deploy — it only builds and pushes images
- All env vars are defined in `infrastructure/resources/cloudrun.ts` only
- Image tag is stored in Pulumi config (`imageTag` key), set dynamically by the deploy workflow
- Rollback: create a new GitHub Release pointing to an older tag
- Preview environments (`preview.yml`) remain independent and use `gcloud run deploy` directly

## Troubleshooting

See `.claude/skills/pulumi-infrastructure/docs/troubleshooting.md` for common errors and their solutions, including:

- Cloud SQL connection timeouts
- Secret Manager permission errors
- Cloud Build Trigger 2nd-gen compatibility issues
- VPC networking configuration
- AdonisJS env validation with Cloud SQL socket paths

## Examples

See `.claude/skills/pulumi-infrastructure/examples/` for copy-paste TypeScript examples of every GCP resource type.
