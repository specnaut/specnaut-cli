# Miximodel — Backlog

> Managed by the Product Owner agent (`/backlog`). Each task lives in
> `tasks/backlog/NNN-slug.md` with structured frontmatter.

## Scoring

- **Complexity**: Fibonacci (1, 2, 3, 5, 8, 13, 21) — story points
- **Priority**: critical > high > medium > low
- **Status**: `todo` | `in_progress` | `done` | `deferred` | `blocked`

---

## Critical

_No critical tasks._

## High Priority

- [ ] `027` — Commercial Launch Readiness — SegPay Onboarding Prerequisites —
      **8 pts** — `commerce` _(legal pages done via `028`; remaining scope is
      business/admin: merchant application, KYC, commercial decisions)_
- [ ] `032` — Replace Payment Processor Secrets with Real Credentials — **1 pt**
      — `commerce` — **BLOCKED** _(placeholder secrets in Pulumi.prod.yaml for
      SegPay & CCBill; blocked on merchant account approval via `027`)_
- [ ] `006` — Buddy / Safety Check-in — **13 pts** — `trust-safety`
- [ ] `010` — Content Reporting — Auto-Moderation (Phase 5) — **8 pts** —
      `trust-safety`
- [ ] `023` — Dagger CI Parity + Real DB Test Pipeline — **13 pts** — `devops` —
      **IN PROGRESS** (spec 182)

## Medium Priority

- [ ] `003` — Contracts (Legal Layer) — **13 pts** — `professional`
- [ ] `004` — Professional References — **8 pts** — `professional`
- [ ] `007` — Polaroids / Digitals — **8 pts** — `content`
- [ ] `011` — Admin Bouncer Granular Policies — **5 pts** — `devex`
- [ ] `012` — Search System Improvements — **5 pts** — `devex`
- [ ] `014` — Manager / Agency Role — **21 pts** — `professional`
- [ ] `016` — Event-Driven Architecture Audit — **8 pts** — `devex`
- [ ] `047` — Keep Add Photo Visible Across ProSyl Tabs — **3 pts** — `content`
      — **IN PROGRESS** _(the owner action to add photos should stay visible on
      ProSyl even when switching tabs; document via SpecKit Clarify whether this
      also needs a corresponding placement in user settings)_
- [ ] `048` — Gate Pricing Surfaces Behind Tier-Plan Feature Flag — **5 pts** —
      `commerce` _(the ConfigCat tier-plan flag should control whether users can
      even see Miximodel pricing surfaces; when disabled, hide both the landing
      pricing section and the standalone pricing page, with fallback behavior to
      clarify during SpecKit and no public pricing before at least one payment
      processor is truly activated; depends on ConfigCat and payment-readiness
      tasks)_
- [ ] `049` — Investigate Role-Optional Signup Flow — **5 pts** — `devex`
      _(study whether signup can create an account without an immediate role,
      then guide the user to choose a role from inside the app with minimal
      onboarding friction)_
- [ ] `050` — Design Guided Post-Login Role Assignment Architecture — **8 pts**
      — `devex` _(define a concrete architecture for signup without immediate
      role selection, followed by an in-app guided role assignment funnel that
      continuously pushes the user to choose a role until the account is
      categorized)_
- [x] `039` — Extract Maintenance Mode Into Dedicated Service — **5 pts** —
      `devex` _(spec 184; move maintenance-specific decision logic out of
      FeatureFlagService into a focused MaintenanceModeService with dedicated
      tests and request integration)_
- [ ] `040` — Define Release-Grade Playwright Strategy on GCP — **8 pts** —
      `devops` _(evaluate whether browser E2E should run automatically on tag /
      Cloud Build, using a deployed release-validation environment and a
      dedicated database instead of the current preview-smoke-only model)_
- [ ] `030` — Async Data Export with Media Files — **8 pts** — `trust-safety`
      _(dependency `013` now done; upgrades sync JSON export to async ZIP with
      actual media from GCS)_
- [ ] `067` — From Radix to Base UI — **13 pts** — `devex` _(replace all Radix
      UI primitives with Base UI across ShadCN components; remove dual-library
      coexistence)_
- [ ] `071` — Improve Design System Color Palette — **5 pts** — `devex` _(refine
      light and dark mode palettes for contrast, accessibility, and visual
      coherence)_
- [ ] `083` — Audit Light Mode Parity + Design Gaps — **3 pts** — `devex`
      _(systematic light-mode audit across the top 10 customer-facing routes —
      contrast, token appropriateness, burgundy integration, `dark:`-only
      styles, forms, hover/disabled states; deliverable is a prioritized
      markdown findings report under `docs/design-audit/`, not a refactor; may
      recommend shadcn semantic-token remaps)_
- [ ] `091` — Immersive Blog Index Redesign — Editorial Magazine Layout —
      **5 pts** — `content` _(replace the 2010-style 3-column card grid on
      `/blog` with a magazine-style mosaic — full-bleed featured article on top,
      tiered tile sizes for the rest, text overlaid on covers via the
      dual-blur scrim system from spec 197, full viewport width with 1920px
      cap, Fraunces serif + burgundy/gold tokens; frontend-only, reuses the
      existing `Article` model + focal-point fields from task 080, preserves
      Cloudflare cache headers from spec 196; SpecKit Specify required to
      nail down tile hierarchy + featured-article rule + mobile behavior)_

## Low Priority

- [ ] `059` — Decide Pulumi State Backend (Cloud Individual vs GCS vs Status
      Quo) — **2 pts** — `devops` _(re-evaluate when Pulumi Cloud trial
      expiration causes real breakage; Option A transfer to personal account
      free tier, Option B migrate state to GCS bucket with KMS encryption,
      Option C do nothing; currently Option C)_
- [ ] `061` — Enable Database Query Observability + Post-Launch Index Tuning —
      **3 pts** — `devops` _(run when >100 active users OR when a perf incident
      needs query-level data; Query Insights + pg_stat_statements +
      auto_explain + initial index audit from real traffic; no preemptive
      indexing)_
- [ ] `063` — Re-evaluate package.json overrides — Are They Still Needed? — **1
      pt** — `devops` _(quarterly audit of the overrides block introduced by
      task 057 + any future additions; for each entry verify upstream has or has
      not published a fix, remove if obsolete, refresh
      `docs/ops/npm-overrides-rationale.md` companion doc since JSON cannot hold
      comments)_
- [ ] `069` — Use GitHub Project for Backlog (Bidirectional Sync) — **5 pts** —
      `devex` _(one-way MD-to-GitHub sync is live; remaining scope is reverse
      sync and full bidirectional operation)_
- [ ] `072` — Add Social Login — **8 pts** — `devex` _(OAuth via @adonisjs/ally;
      Google + Apple; not required for pre-launch)_
- [ ] `086` — Telegram Alert Routing for Cloud Monitoring (PubSub Bridge) —
      **3 pts** — `devops` _(email-only alert delivery misses the 5-minute
      response window; PubSub topic `monitoring-alerts` as sink for ALL
      existing AlertPolicies + Gen2 Cloud Function subscriber that reformats
      incident-open/close payloads and posts to the existing Telegram bot
      (task 017); dual delivery — email + Telegram — on every policy from
      tasks 060 + 085)_
- [ ] `001` — Discounts & Promo Codes — **5 pts** — `commerce`
- [ ] `002` — Sponsorships — **8 pts** — `commerce`
- [ ] `008` — Unified Media Table — **21 pts** — `content`
- [ ] `092` — On-Demand Image Transformations via Cloudflare Image Resizing —
      **3 pts** — `devops` _(future capability for art-direction crops + exotic
      widths the static variant ladder from task 090 cannot pre-generate;
      activates Cloudflare Image Resizing on `media.miximodel.com`, exposes a
      `transformedStorageUrl()` helper returning `/cdn-cgi/image/...` URLs,
      opt-in escape hatch — pre-resized variants stay the default; ~$5/mo for
      100k transforms; depends on `090`)_
- [ ] `096` — Cloudflare Cache Analytics + Egress Cost Monitoring Alert —
      **2 pts** — `devops` _(close spec 202 FR-016 — operator visibility on
      cache hit ratio + bandwidth — by enabling Pro Cache Analytics, documenting
      the dashboard runbook in `docs/ops/media-cdn.md`, and configuring a
      Cloudflare Notifications alert when monthly bandwidth crosses a defined
      threshold (suggested 100 GB starting point, retuned after first month of
      real traffic); Logpush export to GCS Logs deferred to v2; depends on
      spec 202 having merged so real CDN traffic is flowing)_
- [ ] `102` — Tune Cloudflare OWASP Core Ruleset — raise paranoia/threshold
      after first observation window — **2 pts** — `devops` _(task 094 shipped
      both Managed Rulesets in Block mode at Cloudflare's recommended starting
      posture — paranoia 1, threshold 40 — to avoid the well-known FP storm;
      consequence is that minimal synthetic SQLi/XSS payloads on URL params
      still return 200 because their score doesn't cross 40, even though the
      `block` override is in place; after 7 days of real traffic, review WAF
      Events log, raise paranoia 1→2 OR threshold 40→25 on a per-category
      basis (SQLi + XSS first), validate with synthetic smoke tests returning
      403 with `cf-mitigated` response header; this unblocks the proper
      block-on-OWASP-payload claim end-to-end; depends on `094`)_
- [ ] `104` — Polish Newsletter Email Templates — Cross-Client Design
      Refinement — **2 pts** — `communication` _(Kevin validated the new
      black + burgundy confirmation email on `v26.4.24e` but flagged the email
      design as an area to polish further "à la limite ça c'est pas très
      grave"; audit `confirmation.edge` + `confirmation.txt.edge` +
      `blog_broadcast.edge` + `blog_broadcast.txt.edge` for tighter typography
      (Fraunces fallback via @import/@font-face with serif fallback for
      Outlook), dark-mode Gmail/Apple Mail handling, unified `_layout.edge`
      partial shared by both templates, better plain-text variants; manual
      cross-client visual QA on Gmail web/iOS + Apple Mail iOS + Outlook web
      (no paid tools); DKIM + RFC 8058 headers preserved; direct on main — no
      SpecKit needed)_

## Deferred

- [ ] `019` — React Component Testing Setup — **5 pts** — `devex`
- [ ] `009` — Newsletter System — **8 pts** — `communication` _(superseded
      by task `101` — narrower Cloudflare-native scope with REST-based
      delivery; the original admin compose-and-send UI is no longer the
      product direction, v1 newsletter delivery is event-triggered only)_

## Done

- [x] `103` — Redesign Newsletter Confirm + Unsubscribe Landing Pages —
      Immersive Editorial Aesthetic — **3 pts** — `content` _(merged via
      commit `14db3725`; post spec 204 prod activation,
      `/newsletter/confirm` and `/newsletter/unsubscribe` redesigned
      full-bleed on burgundy-950 editorial background with Fraunces h1,
      burgundy-main kicker left-border, burgundy-500 CTA pill with glow
      shadow; shared immersive shell mirrors landing `<NewsletterSignup>`;
      all outcomes preserved (`confirmed`/`expired` on confirm;
      `unsubscribed`/`already_unsubscribed`/`bounced`/`invalid_link` on
      unsubscribe); `canEraseData` affordance rebuilt as a discrete
      burgundy-900/40 left-accent panel (no shadcn Card), post-erase
      aria-live panel switches to `border-main` accent; signup-flow browser
      selector updated to new copy `text=You are in`; typecheck + lint
      clean, 13 newsletter functional + 1 browser test passing; direct on
      main via `feat/103-newsletter-landing-pages-redesign`, FF-merged)_
- [x] `101` — Newsletter Signup + Delivery via Cloudflare Email Services
      (REST API) — **8 pts** — `communication` _(merged via spec `204-newsletter-cloudflare`,
      commit `fd2bd619`; ships the anonymous signup → double opt-in → unsubscribe
      loop + blog-article broadcast + async bounce/complaint webhook +
      registered-user settings toggle + retro-link on account creation + RGPD
      cascade listener; full-bleed burgundy editorial `<NewsletterSignup>` on
      `/` and `/blog` with RFC 8058 `List-Unsubscribe` headers on every
      outbound; REST-from-AdonisJS delivery via `CloudflareEmailTransport` —
      no Worker, no D1, no KV; 4 Postgres tables, 49 unit + 37 functional
      tests green; supersedes legacy task 009; webhook + Pulumi DNS records
      still gated on Kevin T103..T108 dashboard actions before production
      activation)_
- [x] `089` — Improve Mobile Bottom Nav Tappability + Breathing Room — **2 pts**
      — `devex` _(merged via spec `203-mobile-bottom-nav`, commit `9df75260`;
      6-line edit on `inertia/components/mobile_bottom_nav.tsx` — no React
      refactor, design-token-only as scoped: `h-14`→`h-16`, safe-area
      composing bottom padding, tab icons `size-5`→`size-6` (~+20%), compose
      CTA `size-6`→`size-7`; iOS `env(safe-area-inset-bottom)` composed on
      top of breathing room; CSS bundle delta +108 B raw (under NFR-001 200 B
      ceiling); spec 203 acceptance scenarios delivered — touch targets
      ≥44×44 CSS px, safe-area handling, +20% icon size; manual visual
      validation (BEFORE/AFTER screenshots, real-device thumb test) deferred
      to Kevin post-merge)_

- [x] `095` — Configure Super Bot Fight Mode + WAF Custom Rules for Sensitive
      Endpoints — **2 pts** — `devops` _(WAF Custom Rules shipped on
      `miximodel.com`: login brute-force `managed_challenge` gate added as a
      SECOND rule on the existing `mediaRateLimit` ruleset (one-ruleset-per-
      phase constraint, same as task 094 / 100), characteristics
      `[cf.colo.id, ip.src]` alphabetical to dodge backlog 100 array-order
      drift, expression scoped to `POST /login` so the form-render GET stays
      frictionless; Pro tier restricts rate-limit periods to
      `[10,15,20,30,40,45,60]s` so the spec's "5 / 5 min" became **5 / 60s**
      (5 min = Enterprise only) — still bricks credential-stuffing scripts
      ~5 attempts/min vs 50+ unthrottled; webhook skip already in place from
      094; probe skip N/A (app exposes no `/healthz`, GCP uptime checks hit
      `/` with verified bot UA); SBFM API-side tuning DEFERRED — Cloudflare
      API token in `.env` lacks Bot Management scope, but Pro auto-enables
      SBFM with the EXACT defaults this task recommended (Definitely
      automated → Block, Likely automated → Managed Challenge, Verified bots
      → Allow), only `static-resource-protection: off` + `js-detections: off`
      need a manual dashboard flip; `pulumi up` 1 updated 117 unchanged,
      final preview drift-free at 118 unchanged. **Caveat**: brute-force
      smoke test (10 POST /login in <10s) returned 10/10 302 with no
      `cf-mitigated` header — likely Pro propagation delay or Cloudflare
      reputation engine letting trusted operator IP through; rule is
      verified configured via API, re-validate after 24h via WAF Events log
      before claiming end-to-end coverage)_

- [x] `094` — Activate WAF Managed Rulesets (OWASP Core + Cloudflare Managed) —
      **3 pts** — `devops` _(both free WAF Managed Rulesets bundled in
      Cloudflare Pro now active in **Block** mode on `miximodel.com` —
      Cloudflare Managed Ruleset (CVE protection) + OWASP Core Ruleset (OWASP
      top 10) — via new `infrastructure/resources/cloudflare-app-waf.ts`
      (single zone-level Ruleset in `http_request_firewall_managed` phase
      executing both rulesets with `actionParameters.overrides.action: 'block'`
      forcing every child rule to Block instead of per-rule defaults); webhook
      skip on `/api/webhooks/*` added as a SECOND rule on `mediaSbfmSkipRule`
      since only one ruleset per zone is allowed in `http_request_firewall_custom`
      phase; both new resources carry `ignoreChanges: ['rules']` per task 100
      provider-v5 drift workaround; final `pulumi preview` returns 118
      unchanged. **Caveat**: Cloudflare's recommended starting posture is
      paranoia 1 + threshold 40 (intentionally conservative to avoid FP storm),
      so minimal synthetic SQLi/XSS payloads still return 200 — infrastructure
      CAN block but threshold isn't crossed by trivial test payloads; tuning
      after a 7-day observation window tracked in follow-up task 102)_
- [x] `100` — Investigate persistent Pulumi drift on cloudflare
      `media-sbfm-skip` ruleset — **2 pts** — `infra` _(two distinct
      drift sources on `mediaSbfmSkipRule`: (1) `actionParameters.phases`
      array order — Cloudflare API normalizes alphabetically server-side,
      fixed by sorting the local declaration to
      `[http_request_firewall_managed, http_request_sbfm]`;
      (2) residual `~ rules` re-emission on every preview because
      provider v5 + Cloudflare API auto-inject computed defaults
      (`logging.enabled: true`, empty arrays `algorithms`, `autominifies`,
      `headers`, `responses`) the TS source never declares — invisible
      in `--diff` output, `pulumi refresh` does not reconcile, applied
      `ignoreChanges: ['rules']` with inline risk comment block until
      provider v6 upgrade where Ruleset rule shape is fixed; verified
      `pulumi preview` returns `117 unchanged` zero drift on
      `media-sbfm-skip`)_

- [x] `099` — Add Cloudflare Rate Limit rule on media subdomain — cost
      protection — **2 pts** — `infra` _(closes spec 202 deferred review
      finding DEVOPS-H3; new `cloudflare.Ruleset` `mediaRateLimit` in
      `http_ratelimit` phase — `block` action, characteristics
      `[ip.src, cf.colo.id]`, 1000 req / 10s per IP, 30s mitigation,
      `requestsToOrigin: false` so cache-busting unique-path floods still
      trip; required removing `http_ratelimit` from
      `mediaSbfmSkipRule.skip.phases` and `rateLimit` from
      `skip.products` so the rule actually fires; `pulumi up` shipped 1
      created + 1 updated; smoke-tested with browser-UA curl on
      `media.miximodel.com/brand/landing/hero_portrait.jpg` — HTTP 200,
      `cf-cache-status: HIT`, no challenge; `docs/ops/media-cdn.md`
      section 1.1 rulesets table expanded to 4 rows; side effect not
      addressed: pulumi reverted `bootstrap-production` Cloud Run job
      image v26.4.23b → v26.4.22d via imageTag drift, left for next
      release deploy)_
- [x] `098` — Extract MediaVariantRepository — refactor GDPR purge listener to
      use repository pattern — **3 pts** — `refactor` _(closes spec 202
      deferred fix REVIEW-H4; new `app/repositories/media_variant_repository.ts`
      with `findVariantsByUserId(userId)` returning a plain
      `UserVariantsSnapshot` DTO; `purge_cloudflare_on_user_delete.ts` now
      constructor-injects the repo and no longer imports Photo/Article/User
      models; listener spec swapped from static-method monkey-patching to
      constructor-injected stub; 4 new repository tests + 5 listener tests all
      green, typecheck + lint clean — Constitution III compliance restored)_
- [x] `097` — Activate Cloudflare Tiered Cache (improve global hit ratio) —
      **1 pt** — `devops` _(verified `tiered_cache_smart_topology_enable: on`
      via Cloudflare API on 2026-04-23 — was already enabled by Kevin on
      2026-03-24; documented in `docs/ops/media-cdn.md` section 8; future
      regression detection covered by task 096 Cache Analytics runbook)_
- [x] `093` — Activate Cloudflare Polish + Mirage — **1 pt** — `devops`
      _(set `polish: lossy` + `webp: on` via Cloudflare API on 2026-04-23,
      `mirage: on` already enabled; Polish does NOT apply to Cloud Connector
      path on `media.miximodel.com` (Sharp pre-generates WebP variants for
      spec 202) — Polish is the safety net for inline blog images and 3rd-
      party `<img>` references that bypass the variant pipeline; nuance
      documented in `docs/ops/media-cdn.md` section 8)_
- [x] `090` — Image Performance Foundation — CDN + Responsive Variants —
      **13 pts** — `devops` _(merged via spec `202`; 3-tier media architecture
      shipped on `media.miximodel.com` Cloudflare-fronted subdomain — Tier 1
      brand assets with 1-year immutable cache, Tier 2 user uploads with 1-day
      SWR (URL-rewrite cache key normalization), Tier 3 signed URLs only;
      Sharp variant pipeline (400/800/1600/3200 WebP) + `<ResponsiveImage>`
      with srcset; GDPR purge cascade via 3 listeners; 41 new tests; review
      gate findings DEVOPS-H1/H2/H4 + REVIEW-H1/H3 fixed inline, H3/H4
      deferred to backlog 098/099/100)_
- [x] `088` — FakeProcessor Payment Driver for Paywalled Feature Development —
      **8 pts** — `commerce` _(merged via spec `201`; new pluggable driver
      subclassing CCBillDriver with inline CCBill webhook templates,
      three-layer anti-prod guard, dev checkout (Approve/Decline) + on-demand
      `/dev/fake-webhook/:eventType` trigger endpoint, async setImmediate
      dispatch preserving real-world race semantics, real HMAC-SHA256
      verification path exercised; bundled 5 latent subscription-lifecycle
      UX fixes — programmatic cancel keeping users on Miximodel, ordered
      `findByUserId`, `already_subscribed` guard, adaptive `/pricing` CTA,
      upsert-by-user webhook to allow re-subscribe after cancel within the
      `UNIQUE(user_id, provider)` constraint; runbook at
      `docs/commerce/fake-processor.md`)_
- [x] `087` — Log-Based Metrics + Alerts for Payment Webhook Failures — **3
      pts** — `trust-safety` _(closes the application-layer revenue-critical
      visibility gap: 5 `gcp.logging.Metric` resources pinned to the exact
      Pino msg prefixes from the CCBill + SegPay webhook handlers
      (`ccbill.webhook.digest_mismatch`, `segpay.webhook.auth_rejected`,
      `segpay.webhook.parse_failed`, `webhook_event_dedupe.duplicate`
      informational, plus an ERROR-level regex catch-all) + 4 alert policies
      at >5 occurrences / 10 min, all routed to the verified
      `operatorEmailChannel` from task 060; documented two provider quirks
      (log-metric filter forbids `resource.label.*`, metricDescriptor must be
      omitted for simple counters in @pulumi/gcp v8) in devops-sre agent
      memory; verified end-to-end by injecting 40 synthetic digest-mismatch
      entries over 20 min — alert email received at `kevin.raimbaud@gmail.com`)_
- [x] `085` — Platform-Level Monitoring Alerts (Cloud Run + Uptime + Budget) —
      **3 pts** — `devops` _(9 new GCP resources on top of task 060: 4 Cloud
      Run alert policies (5xx count, p99 latency, instance saturation, memory
      p99), 2 uptime checks (landing + pricing) with paired alert policies,
      and a monthly GCP budget (€100 default, 50/80/100% thresholds); reuses
      the verified `operatorEmailChannel` from task 060; thresholds tunable
      via `monitoring:*` Pulumi config namespace; enabled the
      `billingbudgets.googleapis.com` API and added `gcp:billingProject` +
      `gcp:userProjectOverride` to `Pulumi.prod.yaml` for ADC quota routing;
      verified end-to-end by dropping the latency p99 threshold to 1ms with
      a synthetic curl burst against `/pricing` — open + auto-resolve emails
      both confirmed)_
- [x] `074` — Migrate Explore Page Grid to react-photo-album (Harmonize with
      Profile) — **2 pts** — `content` _(replaced custom MasonryGrid on
      `/explore` with `react-photo-album` masonry layout, harmonizing the
      rendering engine with the public profile page (task 073); preserved
      breakpoints (1→2→3→4→5), 8px spacing, hover overlay (role + name +
      username), staggered fade-in delays, and IntersectionObserver-driven
      infinite scroll; deleted `inertia/components/ui/masonry_grid.tsx`
      (explore was the last consumer); net diff −55 lines)_
- [x] `060` — Configure Cloud SQL Monitoring Alerts (CPU / Connections / Disk) —
      **2 pts** — `devops` _(7 alert policies in Pulumi covering CPU warning/
      critical, memory, disk, connections, replication lag, failover; routed to
      a verified email notification channel; thresholds tunable via
      `monitoring:*` Pulumi config namespace; bastion uptime-cap alert from task
      062 also wired to the same channel as boy-scout fix; verified end-to-end
      by dropping CPU threshold to 0.0001 and confirming fired + auto-resolve
      emails landed; Telegram routing deferred — needs Cloud Function bridge,
      out of scope at 2 pts)_
- [x] `062` — IAP-Tunneled Bastion for Secure Production Database Access — **3
      pts** — `devops` _(shipped; e2-micro bastion VM in default VPC, no public
      IP, TERMINATED by default start-on-demand ~$0.20-1/mo, Cloud SQL Auth
      Proxy v2 as systemd service with --private-ip, Private Google Access
      enabled on europe-west1 default subnet, IAP firewall rule to
      35.235.240.0/20, operator IAM bindings (iap.tunnelResourceAccessor +
      compute.osLogin), uptime-cap monitoring alert > 4h as cost safety net,
      docs/ops/db-access.md runbook, discoverability wired into devops-sre
      agent + pulumi-infrastructure skill + AGENTS.md +
      infrastructure/README.md; verified end-to-end by querying prod articles
      via IAP tunnel)_
- [x] `005` — Dispute Resolution System — **13 pts** — `trust-safety` _(merged
      via spec `200`; non-monetary dispute channel between booking parties,
      60-day window, admin queue with
      `{no_action, warning_issued,
account_banned}` resolution enum, 404-not-403
      leak protection, GDPR-cascade-safe via frozen booking snapshot,
      forward-compat for future workshop monetization via open-string
      `resolution_type` column; 11 new test files; full suite 1693 passed)_
- [x] `084` — Logout Does Not Destroy User Session — Critical Account-Takeover
      Via Account Switcher — **5 pts** — `trust-safety` _(critical vuln:
      clicking "Sign out" does not destroy the user's server-side session nor
      remove them from the device-bound account-pool cookie from spec 046; a
      subsequent user on the same device can reopen the signed-out account from
      the switcher without credentials — full takeover on any shared device;
      scope: destroy AdonisJS session server-side + purge pool entry on logout +
      "sign out of all on this device" action; SpecKit required)_
- [x] `079` — Design System Documentation Page (Non-Prod Only) — **5 pts** —
      `devex` _(spec 094; new `/design-system` route registered only when
      `!app.inProduction`, genuine 404 in prod for every URL variation;
      Tailwind-docs-style living documentation of every token — 4 color families
      50→950 with explicit "not defined" placeholders for missing steps awaiting
      task 071, 30 semantic tokens side-by-side in light + dark via a scoped
      `.dark` wrapper, full typography system (sizes/weights/editorial styles),
      Tailwind v4 spacing/radii/shadow scales, 21 shadcn primitives each with
      their full variant/size matrix; utility-class copy-to-clipboard on every
      swatch, sticky anchor nav rail on desktop; page itself styled after the
      landing editorial aesthetic (burgundy + gold + serif display);
      `shared/design_system/` data + types importable from both the service and
      the page via `#shared/*`; does NOT change any token — the page is a pure
      visualizer that makes task 071 trivial to execute; 8 new tests (5 unit + 3
      functional), full suite 1567 passed)_
- [x] `082` — Apply Typography Foundations Site-Wide (Fraunces Rollout) — **5
      pts** — `content` _(spec `198`; rolled out Fraunces display across 18
      files — landing hero + travel section + travel stat, about + mission +
      values + talents blocks, blog index + permalink overlay, FAQ + question
      titles, 6 legal pages, auth login + signup + role picker, public profile
      display name; blog article body reverted to Inter per FR-024; pre-flight
      audit in research.md R-1 covered 12 pre-existing occurrences (11 keeps, 1
      revert, 0 upgrade); zero change to app.css, zero new typeface, zero shadcn
      primitive touch; snapshot-invariant audit test guards future drift; full
      unit suite 1091 passed)_
- [x] `080` — Immersive Blog Permalink Hero Redesign — **5 pts** — `content`
      _(spec `197`; immersive `/blog/:slug` hero extending under navbar with
      metadata overlay bottom-left, dual progressive-blur scrims tuned for WCAG
      AA on any cover image, 1920 px max-width cap on ultra-wide monitors with 4
      % burgundy editorial neutral gutters, per-article focal-point system
      (`focal_point_x`/`focal_point_y` `decimal(4,3)`) applied via
      `object-position` with the 4 launch articles curated; preserves task `035`
      Cloudflare caching + SEO + view-tracking contracts; 24 new unit tests,
      full suite 1085 passed)_
- [x] `081` — Typography Expert Agent / Skill for Fashion + Photography
      Editorial Voice — **3 pts** — `devex` _(new `typography-expert` agent +
      companion `typography` skill under `.claude/`; progressive-disclosure
      references for principles, libre fonts catalog, performance,
      Miximodel-specific stack (Bodoni Moda + Lora + Inter, Vogue.fr aligned,
      English-only / Latin subset), and FAQ; advisor-only — no app fonts
      changed)_
- [x] `078` — Seed Launch Blog Content — 4 Editorial Articles Authored by Agency
      Miximodel — **3 pts** — `content` _(refactored `article_seeder.ts` into a
      thin wrapper over new `ProductionBootstrapService.seedLaunchArticle()`
      with create-if-missing idempotence on slug; 4 articles attributed to
      `agency@miximodel.com` (manifesto "Why We Built Miximodel" + "The Return
      of the Editorial" + "Trust Is the Feature" + "A Home for Touring Talent");
      4 hero images generated via nano-banana in burgundy/cream/gold editorial
      palette, committed under `database/seeders/assets/blog/*.jpg`; new
      `launch-article` step added after `system-users` in
      `PRODUCTION_BOOTSTRAP_ORDER`; 6 new tests; full suite 1578 passed;
      bootstrap:production verified idempotent across two runs)_
- [x] `077` — Self-Serve Admin API Token Management in Settings — **3 pts** —
      `devex` _(admin-only `/api/account/tokens` (list / create / revoke) backed
      by a Bouncer policy + VineJS validator + AccountTokenService; new settings
      page `/settings/api-tokens` reuses spec-195's access-tokens infra —
      GitHub-PAT UX with a one-time plaintext modal + copy-to-clipboard;
      AdonisJS Emitter events `AdminTokenIssued` / `AdminTokenRevoked` +
      `AdminTokenAudit` listener (INFO log, try/catch); no DB schema change, no
      new npm deps; 17 new tests (13 functional + 5 unit), full suite 1573
      passed)_
- [x] `073` — Migrate Public Profile Portfolio Grid to react-photo-album (SSR
      Fix) — **2 pts** — `content` _(delivered by GitHub Copilot via PR #89;
      SpecKit `--copilot` handoff; replaces custom MasonryGrid on `/p/:username`
      with react-photo-album masonry layout, SSR-ready with
      `defaultContainerWidth`)_
- [x] `035` — Extract Blog into Public Layout with CDN Caching — **5 pts** —
      `content` _(spec 196; new PublicLayout reusing PublicNavbar + editorial
      footer, Cloudflare-friendly Cache-Control with Vary on X-Inertia,
      purge-on-mutation via AdonisJS Emitter listener (Principle IX),
      PublicCacheableMiddleware strips Set-Cookie after session/shield flush,
      full SEO (meta + Open Graph + Twitter Card + JSON-LD Article with
      </script> escape + canonical + /sitemap.xml), view-tracking decoupled to
      POST /api/blog/:slug/view, byte-identical HTML for authed vs anon
      (FR-004); 41 new tests, full suite 1556 passed)_
- [x] `076` — Create `miximodel` Claude Code Skill — Blog Publishing via API —
      **3 pts** — `devex` _(umbrella skill under `.claude/skills/miximodel/`
      exposing `/miximodel blog-{create,list,show,update,delete,publish}` plus
      an `api` escape hatch; stdlib-only Python implementation that reads the
      admin Bearer token from a git-ignored skill-local `.env`, parses YAML
      frontmatter + Markdown body, auto-uploads local cover + inline images to
      `/api/blog/media` before create/update; surfaces HTTP errors with status +
      body; mirrors the `configcat` skill pattern with a bash dispatcher +
      Python subcommand module, ready to absorb future `/miximodel <domain>-*`
      namespaces)_
- [x] `068` — Create API Endpoint for Blog — **5 pts** — `content` _(spec 195;
      admin-only JSON CRUD at `/api/blog/*` with scheduled publication + image
      upload, gated by the new `@adonisjs/auth` access-token guard; constitution
      IV amended to permit the `access_tokens` guard for programmatic callers;
      soft-delete + tag-based cache invalidation + magic-byte MIME check;
      `node ace admin:token` CLI for token lifecycle; 27 new tests (21
      functional + 6 unit), full suite green)_
- [x] `075` — Landing Imagery — Add Gold Jewelry Accents for Burgundy + Gold
      Chic Contrast — **2 pts** — `content` _(image-to-image regen of the 5
      landing assets via Gemini 3 Pro Image; added gold earrings on hero, gold
      satin ribbon on collage_1 hat, gold bracelet + ring on collage_2,
      statement gold hoop on collage_3, gold hoops + scarf pin on travel
      portrait; burgundy palette + motion blur + film grain preserved; depends
      on `054`)_
- [x] `054` — Landing Page Polish — Real Imagery, Typography Tracking, Standard
      Buttons — **5 pts** — `content` _(spec 194; wired real burgundy JPEGs on
      the hero + travel section, deleted 5 SVG placeholders + README, tightened
      eyebrow & "MIXIMODEL MOAT" tracking, new shadcn Button size="xl" applied
      to the hero CTA with burgundy glow, hero eye-focus via objectPosition,
      redesigned collages (no border, bigger, soft shadow), PublicNavbar added
      to landing with fixed public links (Pricing/Blog/About/FAQ) + redesigned
      mobile drawer, editorial footer now uses the white SVG logo)_
- [x] `070` — Burgundy Fashion Images for Landing Page — **2 pts** — `content`
      _(generated 5 JPEGs via Gemini 3 Pro Image pipeline on 2026-04-18 —
      burgundy editorial aesthetic with motion blur + film grain; assets
      deployed to `public/landing/`; Kevin validated; code-side SVG removal
      tracked under task 054)_
- [x] `045` — Add Contextual ConfigCat Targeting Plumbing — **5 pts** — `devex`
      _(new `FeatureFlagContextExtractor` builds a request-derived context on
      every Inertia render; `CF-IPCountry` header normalized through `XX`/`T1`
      sentinels to null; anonymous callers with a country still emit a ConfigCat
      User so country rules evaluate; `FEATURE_FLAG_FORCE_COUNTRY` env override
      for local dev; docs + 13 new tests + 1473 tests green)_
- [x] `065` — Align Chat Input Character Limit Across Frontend and Backend — **2
      pts** — `devex` _(extracted `CHAT_LIMITS` single source of truth in
      `config/chat.ts`; Vine validator imports `messageMaxLength`; controller
      exposes `chatLimits` via Inertia props; frontend textarea enforces
      `maxLength` + live counter with muted→amber(80%)→destructive color ramp
      via `usePage`; gates green, 1460 tests passing)_
- [x] `066` — Scale Production Cloud Run Service from 0-1 to 1-5 Instances — **1
      pt** — `devops` _(prod service raised from max=1/min=0 to max=5/min=1 via
      Pulumi bootstrap + `deploy.yml --min-instances/--max-instances` flags +
      one-shot `gcloud run services update` patch on the live service; verified
      `minScale=1` + `maxScale=5` via describe; supersedes task 022)_
- [x] `022` — Cloudflare CDN + Cloud Run Warmup for Public Pages — **5 pts** —
      `devops` _(abandoned in favor of the simpler `066` approach: raise Cloud
      Run `min-instances` from 0 to 1 so the service is always warm. No
      Cloudflare Workers, no synthetic warmup ping, no extra tools — one
      always-on container mitigates cold starts directly at the source)_
- [x] `064` — Mixibot Credits + Rate Limit System (LLM Usage Quotas) — **8 pts**
      — `commerce` _(merged via spec `193`; 2 Postgres tables, CreditService
      reserve/commit/refund, @adonisjs/limiter 10/min middleware, CCBill +
      SegPay webhook tier bridge, daily reset via Cloud Run Job + Scheduler,
      Telegram burn alert at 80%, badge + exhaustion modal in chat UI, 13
      dedicated test files, 1460 tests green)_
- [x] `057` — Clean npm Install — Security + Dependency Tree Health — **5 pts**
      — `devops` _(9 vulns → 1 documented moderate false positive on AdonisJS
      core; Track C override `serialize-javascript@^7.0.5`; Track B bump
      `@google-cloud/storage@^7.19.0` + override `@tootallnate/once@^3.0.1`;
      Track A verified `@adonisjs/http-server@8.2.0` already ships the patched
      `redirect.back()`; Track D documented `.npmrc legacy-peer-deps` with 4
      upstream peer conflicts and added `.npmrc` to Dockerfile COPY)_
- [x] `058` — Apply Cloud SQL Production Hardening (REGIONAL HA + SSL + Backups)
      — **3 pts** — `devops` _(applied REGIONAL HA, ENCRYPTED_ONLY SSL, 30-day
      backup retention, Sunday 03:00 UTC maintenance window via scoped
      `pulumi up --target` on prod stack; verified via
      `gcloud sql instances
describe`; zero Cloud Run drift thanks to --target
      scoping)_
- [x] `056` — Investigate Cloud SQL Pulumi Config for HA + Production Readiness
      — **3 pts** — `devops` _(audit complete; found ZONAL availability, missing
      SSL enforcement, unpinned backup retention; day-2 friction table
      populated; all must-fix items scheduled in follow-up task 058)_
- [x] `055` — Fix Broken Legal Links in Landing Footer — **1 pt** — `content`
      _(retargeted footer /terms /privacy /cookies to /legal/terms-of-service,
      /legal/privacy-policy, and /legal index respectively)_
- [x] `033` — Landing Page Visual Redesign — Immersive Hero-Only Layout — **8
      pts** — `content` _(merged via spec `192`; editorial fashion-magazine
      layout, landing-scoped `--main-color` burgundy token, dual CTA with models
      primary, travel-plan differentiator, editorial footer; polish pass tracked
      as task `054`)_
- [x] `046` — Make Add-Account Flow Feel Safe and Session-Aware — **5 pts** —
      `trust-safety` _(merged via spec `191`; Twitter/X-style dialog keeps
      account A visibly signed in during credential entry, quick-switch
      detection, zero backend refactor)_
- [x] `052` — Implement PWA in the App — **13 pts** — `devex` _(merged via spec
      `190`; installable Web App Manifest, root-scoped service worker with
      payment/auth bypass, bounded GCS cache, maintenance honor, update banner,
      offline fallback; Web Push deferred to a follow-up task)_
- [x] `044` — Standardize Creator Studio on ConfigCat Feature Flag Path — **3
      pts** — `devex` _(shipped via spec `186`, commit `cb8879c7`;
      useFeatureFlag wired in left sidebar + mobile sheet, env-derived
      capability removed)_
- [x] `053` — Fix Following Feed Block/Mute Filters for Originals + Reposts —
      **5 pts** — `trust-safety` _(merged via spec 189; closes spec 188 deferred
      T023/T024; bidirectional block filter on both Following streams)_
- [x] `017` — Telegram Bot Integration — **13 pts** — `communication`
- [x] `020` — Refactor Deployment — Unified Pulumi Deploys — **13 pts** —
      `devops`
- [x] `021` — Claude Code Workflow Orchestration Hardening — **8 pts** — `devex`
- [x] `024` — Storage URL Canonicalization for FS/GCS Parity — **5 pts** —
      `content`
- [x] `025` — Remove Mobile Side Borders from Main Layout — **2 pts** —
      `content`
- [x] `026` — Switch Payment Processor to SegPay — **13 pts** — `commerce`
      _(Phase A merged via spec `177-segpay-integration`; Phase B hardening —
      SRS SOAP cancel, sandbox smoke, IP allowlist, alerting — tracked under
      backlog `027` and blocked on SegPay merchant onboarding)_
- [x] `028` — Legal & Compliance Pages for SegPay Merchant Onboarding — **5
      pts** — `commerce` _(merged via spec `179`, commit `5d39e13f`)_
- [x] `029` — Switch Default Payment Processor to CCBill (with Affiliate
      Program) — **13 pts** — `commerce` _(merged via spec
      `178-ccbill-integration`, commit `4c56d66`)_
- [x] `013` — Delete Account (GDPR Compliance) — **13 pts** — `trust-safety`
      _(merged via spec `180`, commit `cc21225b`)_
- [x] `018` — Wire Checkout Buttons on Pricing Page — **2 pts** — `commerce`
      _(absorbed by `026` — SegPay/CCBill integrations include checkout flow)_
- [x] `031` — Fix Missing Error Feedback on Login Page (Wrong Password) — **2
      pts** — `trust-safety` _(fixed: controller now flashes errors for Inertia
      Form, commit `431d26c2`)_
- [x] `034` — Consolidate Migration Files — Squash ALTER into CREATE — **8 pts**
      — `devex` _(merged 12 ALTER migrations into parent CREATE tables, 86→74
      files, commit `59693eb7`)_
- [x] `036` — Upgrade Cloud SQL PostgreSQL to v18 + Instance Tier — **5 pts** —
      `devops` _(PG16→18 via PG17 stepping stone, tier
      db-f1-micro→db-custom-1-3840, disk 20GB+autoresize)_
- [x] `015` — Switch migration:fresh to migration:run — **3 pts** — `devops`
      _(switched Cloud Run Job from migration:fresh --seed to migration:run
      --force, no more data destruction on deploy)_
- [x] `037` — Maintenance Mode via Environment Variable — **5 pts** — `devops`
      _(merged via spec `181-maintenance-mode`, static HTML 503 page, Pulumi
      config, commit `d6b298bc`)_
- [x] `038` — Implement ConfigCat for Feature Flipping — **5 pts** — `devex`
      _(completed via spec `183`; SDK, provider, env + Pulumi wiring,
      `FeatureFlagService`, frontend snapshot, docs, and real flag consumers are
      now in place; follow-up refinements tracked in `044` and `045`)_
- [x] `041` — Gate Creator Studio Navigation to Non-Production Environments —
      **3 pts** — `content` _(implemented, commit `ba556049`)_
- [x] `042` — Gate Magazine Navigation Behind Feature Flag by Environment — **3
      pts** — `content` _(implemented, commit `ba556049`)_
- [x] `043` — Disable Tier-Plan Promotion Surfaces via Feature Flag — **5 pts**
      — `commerce` _(implemented, commit `ba556049`)_
- [x] `051` — Surface Reposts in the Main Feed — **5 pts** — `content` _(merged
      via spec `188-reposts-in-feed`; Following feed merges reposts with
      originals, consistent repost metadata + ordering)_

---

## Summary

| Metric             | Value |
| ------------------ | ----- |
| Total tasks        | 102   |
| Critical           | 0     |
| High               | 6     |
| Medium             | 20    |
| Low                | 13    |
| Deferred           | 2     |
| Done               | 66    |
| Total story points | 558   |
| Done points        | 325   |
