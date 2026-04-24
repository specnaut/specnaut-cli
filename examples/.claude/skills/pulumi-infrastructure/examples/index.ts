/**
 * Entrypoint — Wire all resource modules and export stack outputs
 *
 * Key concepts:
 * - Import all resource modules so Pulumi registers them
 * - Export useful values as stack outputs (URLs, IPs, names)
 * - Stack outputs are visible via `pulumi stack output`
 * - Use pulumi.interpolate for computed strings from Output<T>
 */
import * as pulumi from '@pulumi/pulumi'
import { registry } from './resources/artifact-registry'
import { mediaBucket } from './resources/storage'
import { service, serviceUrl, migrateJob } from './resources/cloudrun'
import { dbConnectionName, dbPrivateIp } from './resources/database'
import { redisHost, redisPort } from './resources/redis'
import { processScheduledPosts, reconcileBadgeCounters } from './resources/scheduler'

// Stack outputs — visible via `pulumi stack output`
export const cloudRunServiceUrl = serviceUrl
export const bucketName = mediaBucket.name
export const artifactRegistryUrl = pulumi.interpolate`europe-west1-docker.pkg.dev/PROJECT/${registry.repositoryId}`
export { dbConnectionName, dbPrivateIp, redisHost, redisPort }
export const schedulerJobs = [processScheduledPosts.name, reconcileBadgeCounters.name]
