# SegPay — Architecture & Pluggability Rules

> **Load this when:** implementing/reviewing the SegPay driver, or evaluating
> whether a change leaks processor specifics into shared business code.

## Integration Model (mental picture)

SegPay is a **hosted-checkout + postback** processor. Miximodel never handles
card data.

```
┌─────────┐   1. redirect    ┌─────────────┐
│ Browser │ ───────────────► │ SegPay page │
└─────────┘                  └──────┬──────┘
     ▲                              │ 2. user pays
     │                              ▼
     │                       ┌─────────────┐
     │ 4. return URL         │ SegPay core │
     │ ◄──────────────────── └──────┬──────┘
     │                              │ 3. postback (server-to-server)
┌────┴────┐                         ▼
│Miximodel│ ◄── POST /api/webhooks/payment (authenticated)
└─────────┘                              │
     │                                   │
     │     5. admin ops (cancel/refund)  │
     └────────► SRS SOAP web services ◄──┘
```

### Three surfaces

1. **Signup URL / Processing API** — hosted checkout page. Build a URL with
   query parameters (merchant ID, package ID, return URL, pass-through custom
   fields for idempotency and user id) and redirect the user there.
2. **Postbacks** — server-to-server POSTs (form-urlencoded) sent by SegPay on
   lifecycle events. **The authoritative source of truth for subscription
   state.**
3. **SRS SOAP Web Services** — two SOAP services (Reporting + Admin) for queries
   and admin operations (cancel, refund, fetch).

## Non-Negotiable Architectural Rules

These are the pluggability contract. Violating any one of them breaks the
Strategy Pattern and invalidates spec 177 (`FR-014` through `FR-022`).

1. **All SegPay-specific code lives in exactly one file:**
   `app/services/payment/segpay_driver.ts`. No exceptions.
2. **`PaymentContract` is the single abstraction.** No service, controller,
   listener, or Inertia page may depend on a concrete driver.
3. **Provider identifiers live in one typed registry.** The literal `'segpay'`
   may appear in exactly one place outside the driver: that registry (e.g.
   `app/contracts/payment_providers.ts`).
4. **Postbacks are normalized inside the driver** into a canonical
   `NormalizedWebhookEvent` before `WebhookService` sees them:
   ```ts
   type NormalizedWebhookEvent = {
      type:
         | "subscription.created"
         | "subscription.updated"
         | "subscription.cancelled"
         | "subscription.expired"
         | "subscription.past_due";
      providerSubscriptionId: string;
      providerCustomerId: string;
      status: "active" | "cancelled" | "expired" | "past_due";
      occurredAt: DateTime;
      rawPayload: Record<string, unknown>; // preserved for audit
   };
   ```
5. **Authenticity verification is the driver's job.** Controllers hand the
   driver the raw body and headers; the driver decides whether to accept.
6. **Checkout URL construction is the driver's job.** Controllers receive an
   opaque URL and redirect.
7. **Cancellation / refunds go through the driver's SRS call**, not directly
   from a controller.
8. **Configuration is namespaced per driver:** `SEGPAY_*`, future `CCBILL_*`,
   etc. Never rename existing processor config for a new one.
9. **Postbacks are the source of truth.** Browser return URLs are UX hints; if
   the two disagree, the postback wins.
10. **Idempotency is mandatory.** Every postback carries a transaction ID
    (`tranid`); duplicates produce the same final state as a single delivery.
11. **Postbacks are `application/x-www-form-urlencoded`, not JSON.** Parse the
    raw body appropriately.
12. **Zero references to the previous Lemon Squeezy integration** in runtime
    code, tests, config, or dependencies.

## The Paper-Exercise Test

Before claiming any SegPay work is complete, mentally walk through adding a
hypothetical `CCBillDriver`. If the diff touches any of the following, **the
abstraction is leaking** and you must tighten the contract:

- `subscription_service.ts`
- `webhook_service.ts`
- Any controller
- Any model beyond the driver's own
- Any migration beyond the neutral `provider_price_id_*` columns
- Any Inertia page

**Acceptable diff for a new driver:**

- New `app/services/payment/{provider}_driver.ts`
- New provider identifier in the registry
- New `{PROVIDER}_*` env vars and secrets
- New IoC binding in `providers/payment_provider.ts`
- New driver-specific tests
- Nothing else.

## File Layout

```
app/
├── contracts/
│   ├── payment.ts                 ← PaymentContract (unchanged across drivers)
│   └── payment_providers.ts       ← typed registry (single source of 'segpay')
├── services/payment/
│   ├── segpay_driver.ts           ← ALL SegPay code here
│   ├── subscription_service.ts    ← driver-agnostic
│   └── webhook_service.ts         ← reads only NormalizedWebhookEvent
providers/
└── payment_provider.ts            ← IoC binding (single rebind point)
```

## Extension Playbook (for future processors)

When adding a processor other than SegPay:

1. Create `app/services/payment/{provider}_driver.ts` implementing
   `PaymentContract`.
2. Add the provider to the typed registry in `payment_providers.ts`.
3. Add `{PROVIDER}_*` env vars to `start/env.ts` and `.env.example`.
4. Add `{PROVIDER}_*` secrets to `infrastructure/resources/secrets.ts` and wire
   them into `cloudrun.ts`.
5. Rebind `PaymentContract` → new driver in `providers/payment_provider.ts`.
6. Write driver-specific unit + functional tests.
7. **If the diff touches anything else, stop. The abstraction is leaking. Fix
   the contract, not the diff.**
