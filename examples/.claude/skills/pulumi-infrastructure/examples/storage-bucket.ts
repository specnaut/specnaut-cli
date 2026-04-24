/**
 * Cloud Storage Bucket — Object storage for uploads, media, backups
 *
 * Key concepts:
 * - uniformBucketLevelAccess: true = IAM-only access (no ACLs per object)
 * - publicAccessPrevention: 'enforced' = no public access, use signed URLs
 * - forceDestroy: false = Pulumi refuses to delete bucket with objects
 * - Bucket names are globally unique across all GCP projects
 */
import * as gcp from '@pulumi/gcp'

// Private bucket (user uploads, media)
export const mediaBucket = new gcp.storage.Bucket('my-media', {
  name: 'my-project-media', // globally unique
  location: 'europe-west1',
  uniformBucketLevelAccess: true,
  publicAccessPrevention: 'enforced',
  forceDestroy: false,
})

// Public bucket (static assets, CDN)
export const publicBucket = new gcp.storage.Bucket('my-assets', {
  name: 'my-project-assets',
  location: 'europe-west1',
  uniformBucketLevelAccess: true,
  website: {
    mainPageSuffix: 'index.html',
    notFoundPage: '404.html',
  },
})
