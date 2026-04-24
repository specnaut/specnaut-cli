/**
 * VPC Network — Private networking for Cloud Run, Cloud SQL, Redis
 *
 * Key concepts:
 * - VPC Connector: bridges Cloud Run (serverless) to VPC network
 * - Private Service Access: enables private IPs for managed services (Cloud SQL)
 * - Without these, Cloud Run CANNOT reach Cloud SQL or Redis private IPs
 *
 * Architecture:
 *   Cloud Run → VPC Connector → VPC Network → Cloud SQL (private IP)
 *                                            → Redis Memorystore
 *
 * IMPORTANT: Private Service Access creation takes ~60 seconds.
 * Cloud SQL depends on it — use dependsOn in the database resource.
 */
import * as gcp from '@pulumi/gcp'

// --- VPC Connector (Cloud Run → VPC) ---
export const vpcConnector = new gcp.vpcaccess.Connector('my-connector', {
  name: 'my-connector',
  region: 'europe-west1',
  network: 'default',
  ipCidrRange: '10.8.0.0/28', // small range, 14 usable IPs
  minInstances: 2, // minimum for availability
  maxInstances: 3, // keep costs low
})

// --- Private Service Access (Cloud SQL private IP) ---
const privateIpRange = new gcp.compute.GlobalAddress('my-private-ip-range', {
  name: 'my-private-ip-range',
  purpose: 'VPC_PEERING',
  addressType: 'INTERNAL',
  prefixLength: 16,
  network: 'projects/PROJECT/global/networks/default',
})

export const privateConnection = new gcp.servicenetworking.Connection('my-private-connection', {
  network: 'projects/PROJECT/global/networks/default',
  service: 'servicenetworking.googleapis.com',
  reservedPeeringRanges: [privateIpRange.name],
})

// Usage in Cloud Run:
// vpcAccess: {
//   connector: vpcConnector.id,
//   egress: 'PRIVATE_RANGES_ONLY',
// }
//
// Usage in Cloud SQL:
// { dependsOn: [privateConnection] }
