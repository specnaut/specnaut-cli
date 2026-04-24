---
name: spec202_infra_audit
description: Security/reliability audit findings for spec 202 (Image CDN + GCS buckets + Cloudflare). Captures decisions and accepted risks.
type: project
---

Spec 202 infra audit completed 2026-04-22. Key accepted decisions:
- SBFM/WAF skip on entire media subdomain is intentional (image CDN must be open to all crawlers).
- Tier-2 public read with 16-char hashed paths is the agreed privacy model (Instagram model, accepted by Kevin).
- No CORS config on GCS buckets — intentional; Cloudflare handles cross-origin for <img> loads.
- No lifecycle rules on Tier-2 bucket — GDPR purge is app-layer only (object delete + Cloudflare purge).
- `publicAccessPrevention: 'inherited'` on Tier-1/2 is the documented intentional choice (not a gap).

**Why:** These findings shape which issues are real bugs vs. accepted design decisions, so future audit agents don't re-litigate them.

**How to apply:** When reviewing storage.ts or cloudflare-media.ts, do not flag the public IAM, missing CORS, or SBFM skip as findings — they are documented intentional choices. The remaining open gaps (objectAdmin over objectCreator, Cloudflare token scope, no query-string cache key, no GCS audit log, no Tier-2 soft-delete/versioning) are the live action items.
