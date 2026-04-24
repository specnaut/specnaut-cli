/**
 * Cloud Build Trigger — CI/CD pipeline triggered by git events
 *
 * Key concepts:
 * - repositoryEventConfig: 2nd gen (Developer Connect) — modern GitHub integration
 * - github: 1st gen — legacy but simpler, uses GitHub App
 * - filename: path to cloudbuild.yaml in the repo
 * - substitutions: variables available as $_VAR in cloudbuild.yaml
 * - serviceAccount: the SA that Cloud Build runs as (needs appropriate roles)
 *
 * KNOWN ISSUE: 2nd gen triggers (Developer Connect) may fail with
 * "failed to get service account gaia id" when updated via Pulumi.
 * Workaround: manage the trigger outside Pulumi or use ignoreChanges.
 * See docs/troubleshooting.md for details.
 */
import * as gcp from '@pulumi/gcp'

// --- 2nd Gen (Developer Connect) — tag-based trigger ---
export const tagTrigger = new gcp.cloudbuild.Trigger(
  'my-tag-trigger',
  {
    name: 'my-tag-trigger',
    location: 'europe-west1',
    description: 'Deploy on git tag push',
    filename: 'cloudbuild.yaml',
    tags: ['deploy', 'github'],
    serviceAccount: 'projects/PROJECT/serviceAccounts/MY_SA@PROJECT.iam.gserviceaccount.com',
    repositoryEventConfig: {
      repository:
        'projects/PROJECT/locations/REGION/connections/CONNECTION/gitRepositoryLinks/REPO_LINK',
      push: {
        tag: '^v.*', // trigger on any tag starting with v
      },
    },
    substitutions: {
      _REGION: 'europe-west1',
      _APP_NAME: 'my-app',
    },
  },
  { protect: true }
)

// --- 1st Gen (GitHub App) — branch-based trigger ---
// Simpler but older integration method
export const branchTrigger = new gcp.cloudbuild.Trigger('my-branch-trigger', {
  name: 'my-branch-trigger',
  location: 'global', // 1st gen triggers are always global
  filename: 'cloudbuild.yaml',
  github: {
    owner: 'my-org',
    name: 'my-repo',
    push: {
      branch: '^main$',
    },
  },
})
