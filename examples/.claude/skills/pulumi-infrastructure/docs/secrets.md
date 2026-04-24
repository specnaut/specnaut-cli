# Secret Management — Pulumi + GCP Secret Manager

## Two Layers of Encryption

1. **Pulumi Config** (`Pulumi.prod.yaml`) — encrypts values at rest in the stack config file
2. **GCP Secret Manager** — stores the runtime values, accessible by Cloud Run via IAM

## Workflow

```
Developer                    Pulumi Config              GCP Secret Manager        Cloud Run
    │                            │                            │                      │
    ├─ pulumi config set ───────►│ encrypted in yaml          │                      │
    │   --secret dbPassword      │                            │                      │
    │                            │                            │                      │
    ├─ pulumi up ───────────────►│─── decrypts ──────────────►│ creates Secret +     │
    │                            │    at deploy time          │ SecretVersion         │
    │                            │                            │                      │
    │                            │                            │◄── secretKeyRef ─────┤
    │                            │                            │    reads at runtime   │
```

## Pattern: Secret + Version + IAM

Every secret needs three resources:

```typescript
// 1. Container
const secret = new gcp.secretmanager.Secret('MY_SECRET', {
  secretId: 'MY_SECRET',
  replication: { auto: {} },
})

// 2. Value (from encrypted Pulumi config)
new gcp.secretmanager.SecretVersion('MY_SECRET-v1', {
  secret: secret.id,
  secretData: config.requireSecret('mySecret'),
})

// 3. IAM (grant Cloud Run access)
new gcp.secretmanager.SecretIamMember('MY_SECRET-accessor', {
  secretId: secret.id,
  role: 'roles/secretmanager.secretAccessor',
  member: `serviceAccount:${computeServiceAccount}`,
})
```

## Naming Convention

Prefix secrets with the project name to avoid collisions across sub-projects:

```
MYAPP_APP_KEY          (not APP_KEY)
MYAPP_DB_PASSWORD      (not DB_PASSWORD)
MYAPP_SCHEDULER_SECRET (not SCHEDULER_SECRET)
```

## Cloud Run Reference

```typescript
envs: [
  {
    name: 'DB_PASSWORD', // env var name inside the container
    valueSource: {
      secretKeyRef: {
        secret: dbPasswordSecret.secretId, // Secret Manager secret ID
        version: 'latest',
      },
    },
  },
]
```

## Finding the Compute Service Account

The default compute service account follows this pattern:

```
PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

Find it with:

```bash
gcloud iam service-accounts list --filter="email:compute@developer"
```

## Rotating Secrets

1. Update the value: `pulumi config set --secret mySecret "new-value"`
2. Deploy: `pulumi up` (creates a new SecretVersion)
3. Cloud Run picks up `latest` on next revision
