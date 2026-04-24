---
name: Cloud SQL production state (post-task-056 audit)
description: Current Cloud SQL configuration gaps and planned hardening task 057
type: project
---

Cloud SQL instance `miximodel-db` is ZONAL (no HA standby), PG18, `db-custom-1-3840`,
20 GB SSD + autoresize to 100 GB cap, private IP only, backups + PITR enabled
but retention/WAL days not pinned in Pulumi. `availabilityType` is absent (defaults ZONAL).
SSL mode not enforced. No maintenance window set.

**Why:** Task 056 (2026-04-15) audited the full production readiness posture.
REGIONAL HA is the critical gap for a payment-handling app.

**How to apply:** Task 057 will implement all hardening changes as a single
`pulumi up` session: REGIONAL HA, backup retention pinning, SSL enforcement,
maintenance window, multi-regional backup location, autoresize cap raise.
Until 057 is done, treat Cloud SQL HA as an open launch blocker.
