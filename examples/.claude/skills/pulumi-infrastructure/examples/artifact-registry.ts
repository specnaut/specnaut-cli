/**
 * Artifact Registry — Docker image repository
 *
 * Key concepts:
 * - format: 'DOCKER' for container images (also supports npm, Maven, Python, etc.)
 * - cleanupPolicies: auto-delete old images to save storage costs
 * - Image URL pattern: REGION-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG
 * - Auth: `gcloud auth configure-docker REGION-docker.pkg.dev`
 */
import * as gcp from '@pulumi/gcp'

export const registry = new gcp.artifactregistry.Repository(
  'my-registry',
  {
    repositoryId: 'my-registry',
    location: 'europe-west1',
    format: 'DOCKER',
    description: 'Docker images for My Project',

    // Optional: immutable tags prevent overwriting (e.g., :latest won't work)
    dockerConfig: { immutableTags: false },

    // Optional: auto-delete images older than 7 days matching a pattern
    cleanupPolicies: [
      {
        id: 'delete-old-images',
        action: 'DELETE',
        condition: { olderThan: '604800s', tagState: 'ANY' },
      },
    ],
  },
  { protect: true }
)

// Image URL for use in Cloud Run / Cloud Build
// europe-west1-docker.pkg.dev/PROJECT/my-registry/IMAGE:TAG
