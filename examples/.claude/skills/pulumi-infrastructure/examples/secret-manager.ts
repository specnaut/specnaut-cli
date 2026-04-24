/**
 * Secret Manager — Encrypted secrets with IAM access control
 *
 * Key concepts:
 * - Secret: the container (name, replication config)
 * - SecretVersion: the actual value (stored encrypted)
 * - SecretIamMember: grants access to a service account
 * - Values come from `pulumi config set --secret KEY VALUE` (encrypted in stack yaml)
 * - Cloud Run references secrets via envs[].valueSource.secretKeyRef
 *
 * Pattern: Secret + SecretVersion + IamMember per secret
 * Naming: prefix with project name to avoid collisions (e.g., MYAPP_DB_PASSWORD)
 */
import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const computeServiceAccount = 'PROJECT_NUMBER-compute@developer.gserviceaccount.com'

// --- Example: Database password ---

export const dbPasswordSecret = new gcp.secretmanager.Secret('MYAPP_DB_PASSWORD', {
  secretId: 'MYAPP_DB_PASSWORD',
  replication: { auto: {} },
})

export const dbPasswordVersion = new gcp.secretmanager.SecretVersion('MYAPP_DB_PASSWORD-v1', {
  secret: dbPasswordSecret.id,
  secretData: config.requireSecret('dbPassword'), // from Pulumi.prod.yaml
})

// Grant Cloud Run service account access to read this secret
new gcp.secretmanager.SecretIamMember('MYAPP_DB_PASSWORD-accessor', {
  secretId: dbPasswordSecret.id,
  role: 'roles/secretmanager.secretAccessor',
  member: `serviceAccount:${computeServiceAccount}`,
})

// --- Store the secret value ---
// Run: pulumi config set --secret dbPassword "my-super-secret-value"
// This encrypts it in Pulumi.prod.yaml automatically.
