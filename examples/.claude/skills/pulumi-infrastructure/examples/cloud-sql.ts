/**
 * Cloud SQL PostgreSQL — Managed database with private IP
 *
 * Key concepts:
 * - ALWAYS use private IP (ipv4Enabled: false) for Cloud Run access
 * - Requires Private Service Access (VPC peering) — see vpc-network.ts
 * - dependsOn privateConnection to ensure VPC peering is ready
 * - db-f1-micro: cheapest tier (~$7/month), suitable for dev/small prod
 * - deletionProtection: true prevents accidental `pulumi destroy`
 * - Point-in-time recovery enables granular backup restoration
 *
 * IMPORTANT: Changing network config (public -> private) takes 15-20 minutes.
 * Cloud SQL instance creation takes 10-15 minutes.
 */
import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()

// The privateConnection must be created first (see vpc-network.ts)
declare const privateConnection: gcp.servicenetworking.Connection

export const dbInstance = new gcp.sql.DatabaseInstance(
  'my-db',
  {
    name: 'my-db',
    region: 'europe-west1',
    databaseVersion: 'POSTGRES_16',
    deletionProtection: true,
    settings: {
      tier: 'db-f1-micro', // Cheapest: shared CPU, 614MB RAM
      edition: 'ENTERPRISE',
      diskSize: 10, // GB, auto-grows
      diskType: 'PD_SSD',
      ipConfiguration: {
        ipv4Enabled: false, // No public IP — private only
        privateNetwork: 'projects/PROJECT/global/networks/default',
      },
      backupConfiguration: {
        enabled: true,
        startTime: '03:00', // UTC
        pointInTimeRecoveryEnabled: true,
      },
    },
  },
  { dependsOn: [privateConnection] }
)

export const database = new gcp.sql.Database('my-database', {
  name: 'my-database',
  instance: dbInstance.name,
})

export const dbUser = new gcp.sql.User('my-user', {
  name: 'my-user',
  instance: dbInstance.name,
  password: config.requireSecret('dbPassword'),
})

export const dbPrivateIp = dbInstance.privateIpAddress
export const dbConnectionName = dbInstance.connectionName
