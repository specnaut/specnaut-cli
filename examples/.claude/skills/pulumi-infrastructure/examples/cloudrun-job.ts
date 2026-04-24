/**
 * Cloud Run Job — One-off or scheduled batch task (e.g., database migrations)
 *
 * Key concepts:
 * - Jobs run to completion, unlike services which run indefinitely
 * - maxRetries: how many times to retry on failure (0 = no retry)
 * - timeout: max execution time per task
 * - executionEnvironment: GEN2 for better performance
 * - Pulumi manages the job *definition*, not executions
 * - Trigger execution via: gcloud run jobs execute JOB_NAME --region=REGION
 */
import * as gcp from '@pulumi/gcp'

const image = 'REGION-docker.pkg.dev/PROJECT/REPO/APP:TAG'

export const migrateJob = new gcp.cloudrunv2.Job(
  'my-migrate-job',
  {
    name: 'my-migrate-job',
    location: 'europe-west1',
    template: {
      template: {
        maxRetries: 2,
        timeout: '600s',
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        serviceAccount: 'COMPUTE_SA@PROJECT.iam.gserviceaccount.com',

        // VPC access (same as service if needed)
        vpcAccess: {
          connector: 'projects/PROJECT/locations/REGION/connectors/CONNECTOR',
          egress: 'PRIVATE_RANGES_ONLY',
        },

        containers: [
          {
            name: 'migrator',
            image,
            commands: ['node'],
            args: ['ace.js', 'migration:run', '--force'],
            envs: [
              { name: 'DB_HOST', value: '10.x.x.x' },
              // ... same env vars as the service
            ],
          },
        ],
      },
    },
  },
  { protect: true }
)
