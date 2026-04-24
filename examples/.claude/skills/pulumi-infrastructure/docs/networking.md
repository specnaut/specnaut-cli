# Networking — Cloud Run, Cloud SQL, Redis Private Access

## The Problem

Cloud Run is serverless — it runs outside the VPC by default. Cloud SQL (private IP) and Redis Memorystore are only accessible from within the VPC. Without networking configuration, Cloud Run cannot reach the database or cache.

## Architecture

```
Internet → Cloud Run Service
               │
               ├── VPC Connector (10.8.0.0/28)
               │        │
               │        ├── Cloud SQL (private IP: 10.x.x.x)
               │        │     via Private Service Access (VPC peering)
               │        │
               │        └── Redis Memorystore (private IP: 10.x.x.x)
               │              directly on VPC
               │
               └── Secret Manager (public API, IAM-authenticated)
```

## Components

### 1. VPC Connector

Bridges Cloud Run to the VPC network. Required for ANY private service access.

- **Resource**: `gcp.vpcaccess.Connector`
- **CIDR**: `/28` range (14 usable IPs) — e.g., `10.8.0.0/28`
- **Instances**: min 2, max 3 (keep costs low)
- **Cost**: ~$0.01/hour per instance + data transfer
- **API**: `vpcaccess.googleapis.com`

### 2. Private Service Access (Cloud SQL)

Cloud SQL private IP requires a VPC peering between your network and Google's service network.

- **Resources**: `gcp.compute.GlobalAddress` + `gcp.servicenetworking.Connection`
- **Prefix**: `/16` reserved range for Google services
- **API**: `servicenetworking.googleapis.com`
- **Creation time**: ~60 seconds

### 3. Redis Memorystore

Automatically placed on the VPC — no additional networking config needed beyond the VPC Connector.

## Cloud Run Configuration

```typescript
template: {
  vpcAccess: {
    connector: vpcConnector.id,
    egress: 'PRIVATE_RANGES_ONLY', // only private IPs go through VPC
  },
}
```

`PRIVATE_RANGES_ONLY` means:

- Requests to `10.x.x.x` → routed through VPC (Cloud SQL, Redis)
- Requests to public IPs → direct internet (Secret Manager API, external APIs)

`ALL_TRAFFIC` would route everything through VPC — more secure but slower for public endpoints.

## Common Mistakes

### Using public IP for Cloud SQL

Cloud SQL public IP requires "Authorized Networks" — but Cloud Run doesn't have a fixed IP. Either:

- Use private IP (recommended) — requires VPC Connector + Private Service Access
- Use Cloud SQL Auth Proxy — but socket paths may fail framework validation (see troubleshooting)

### Using Unix socket path as DB_HOST

Some frameworks (AdonisJS, Rails) validate `DB_HOST` as a domain or IP. The Cloud SQL socket path (`/cloudsql/project:region:instance`) fails this validation. **Always use the private IP address instead.**

### Forgetting dependsOn for Private Service Access

Cloud SQL will fail to create with private IP if the VPC peering isn't ready:

```typescript
// WRONG — may fail with "network not found"
new gcp.sql.DatabaseInstance('db', { ... })

// CORRECT
new gcp.sql.DatabaseInstance('db', { ... }, { dependsOn: [privateConnection] })
```
