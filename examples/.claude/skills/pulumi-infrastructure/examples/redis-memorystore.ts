/**
 * Redis Memorystore — Managed Redis on GCP private network
 *
 * Key concepts:
 * - Only accessible from the VPC (no public IP) — Cloud Run needs VPC Connector
 * - BASIC tier: no replication, cheapest (~$35/month for 1GB)
 * - STANDARD_HA tier: automatic failover with replica
 * - memorySizeGb: minimum 1GB (GCP requirement)
 * - Creation takes ~5-6 minutes
 */
import * as gcp from '@pulumi/gcp'

export const redisInstance = new gcp.redis.Instance('my-redis', {
  name: 'my-redis',
  region: 'europe-west1',
  tier: 'BASIC', // or 'STANDARD_HA' for high availability
  memorySizeGb: 1,
  redisVersion: 'REDIS_7_2',
  displayName: 'My Redis Instance',
})

export const redisHost = redisInstance.host // e.g., 10.191.89.227
export const redisPort = redisInstance.port // 6379
