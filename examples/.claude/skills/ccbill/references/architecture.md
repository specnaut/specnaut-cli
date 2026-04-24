# CCBill — Architecture Reference

> Load this file when implementing, reviewing, or debugging the
> CCBill driver or the `PaymentContract` abstraction.

## Integration Model

```
User clicks "Subscribe"
        │
        ▼
┌─────────────────┐     ┌──────────────────┐
│  CCBillDriver   │────▶│  CCBill FlexForms │  (hosted checkout)
│  .createCheckout│     │  (external page)  │
└─────────────────┘     └──────────────────┘
                               │
                        User pays on CCBill
                               │
                               ▼
                    ┌─────────────────────┐
                    │  CCBill Webhook      │
                    │  (Background Post)   │
                    │  POST /api/webhooks/ │
                    │  payment             │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  WebhookController   │
                    │  (reads raw body)    │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  CCBillDriver        │
                    │  .verifyAndNormalize │
                    │  Webhook()           │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  WebhookService      │
                    │  .handleEvent()      │
                    │  (canonical shape)   │
                    └─────────────────────┘
```

## Driver Location

All CCBill-specific code lives in **exactly one file**:
`app/services/payment/ccbill_driver.ts`

## PaymentContract Methods

The driver MUST implement all methods from `app/contracts/payment.ts`:

| Method                       | CCBill Implementation                        |
| ---------------------------- | -------------------------------------------- |
| `createSubscriptionCheckout` | Build FlexForms URL with dynamic pricing     |
| `getCustomerPortalUrl`       | Return CCBill consumer self-service URL      |
| `cancelSubscription`         | Call RESTful API or DataLink cancel endpoint  |
| `getSubscription`            | Call RESTful API lookup                       |
| `verifyAndNormalizeWebhook`  | Verify digest/IP, map to NormalizedWebhookEvent |

## Non-Negotiable Rules

1. **Single-file driver.** All CCBill logic in `ccbill_driver.ts`.
2. **No imports of ccbill_driver outside the IoC binding.**
   `providers/payment_provider.ts` is the only file that knows
   `CCBillDriver` exists.
3. **Provider string `'ccbill'` appears in exactly one place:**
   `app/contracts/payment_providers.ts`.
4. **Webhooks normalize inside the driver** into
   `NormalizedWebhookEvent` before `WebhookService` sees them.
5. **Signature/digest verification inside the driver** on raw body.
6. **Checkout URL construction inside the driver.** Controllers
   redirect to an opaque string.
7. **formDigest computed server-side.** The salt NEVER reaches
   the client.
8. **Affiliate ID propagation inside the driver.** The driver
   reads the affiliate param from checkout input and embeds it in
   the FlexForms URL.

## Paper-Exercise Test

Before claiming any CCBill work is complete, mentally walk through
adding a hypothetical `EpochDriver`. If the diff touches any of:

- `subscription_service.ts`
- `webhook_service.ts`
- Any controller
- Any model beyond the driver's own
- Any migration beyond neutral columns
- Any Inertia page

...the abstraction is leaking. Fix the contract, not the diff.

## Key Differences from SegPay

| Aspect              | SegPay                          | CCBill                            |
| ------------------- | ------------------------------- | --------------------------------- |
| Checkout            | Signup URL (query params)       | FlexForms URL (formId + params)   |
| Webhook format      | form-urlencoded                 | JSON (webhook v2+)                |
| Webhook auth        | HTTP Basic Auth + secret echo   | Digest verification or IP allowlist |
| Idempotency key     | `tranid`                        | `transactionId`                   |
| Admin API           | SRS SOAP                        | RESTful Transaction API + DataLink |
| Auth for admin API  | User ID + access key            | OAuth2 Bearer token               |
| Affiliate           | N/A (deferred in spec 177)      | Legacy Affiliate System (native)  |
| Merchant of Record  | No                              | Yes (handles VAT)                 |

## Relevant URLs

- FlexForms: https://ccbill.com/doc/flexforms-overview
- Webhooks: https://ccbill.com/doc/webhooks-overview
- API Guide: https://ccbill.com/doc/ccbill-api-guide
- Payment Processors Playbook: `docs/payment-processors.md`
