/**
 * Cloud Run Service — Long-running HTTP service
 *
 * Key concepts:
 * - containerPort: the port your app listens on (GCP sets PORT env var automatically)
 * - cpuIdle: true = CPU throttled between requests (cheaper, good for low-traffic)
 * - startupCpuBoost: true = full CPU during cold start (faster boot)
 * - vpcAccess: required to reach private services (Cloud SQL, Redis)
 * - secretKeyRef: reference secrets from Secret Manager as env vars
 */
import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

// Typical image reference from Artifact Registry
const image = 'REGION-docker.pkg.dev/PROJECT/REPO/APP:TAG'

export const service = new gcp.cloudrunv2.Service(
  'my-service',
  {
    name: 'my-service',
    location: 'europe-west1',
    ingress: 'INGRESS_TRAFFIC_ALL',

    // Set to true if you don't want GCP to auto-create an IAM invoker binding
    invokerIamDisabled: true,

    template: {
      // Scaling
      scaling: { maxInstanceCount: 1 },

      // VPC access for private services (Cloud SQL, Redis)
      vpcAccess: {
        connector: 'projects/PROJECT/locations/REGION/connectors/CONNECTOR_NAME',
        egress: 'PRIVATE_RANGES_ONLY', // only route private IPs through VPC
      },

      containers: [
        {
          name: 'my-service',
          image,
          ports: { containerPort: 8080 },
          resources: {
            limits: { cpu: '1000m', memory: '512Mi' },
            cpuIdle: true,
            startupCpuBoost: true,
          },
          envs: [
            // Plain text env vars
            { name: 'NODE_ENV', value: 'production' },
            { name: 'DB_HOST', value: '10.x.x.x' }, // Cloud SQL private IP

            // Secret from Secret Manager
            {
              name: 'APP_KEY',
              valueSource: {
                secretKeyRef: { secret: 'MY_APP_KEY', version: 'latest' },
              },
            },
          ],
        },
      ],
    },
  },
  { protect: true } // prevent accidental deletion
)

export const serviceUrl = service.uri
