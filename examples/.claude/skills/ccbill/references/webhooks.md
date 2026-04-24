# CCBill — Webhooks Reference

> Load this file when implementing, debugging, or reviewing the webhook handler,
> event normalization, or verification logic.

## Overview

CCBill sends **server-to-server HTTP POST** requests (webhooks) to a
merchant-configured URL for every subscription lifecycle event. These are the
**source of truth** — browser return URLs are UX hints.

## Webhook Events

| CCBill Event         | Maps to NormalizedWebhookEvent.type | Description                    |
| -------------------- | ----------------------------------- | ------------------------------ |
| `NewSaleSuccess`     | `subscription.created`              | Initial purchase completed     |
| `NewSaleFailure`     | (ignored or logged)                 | Payment attempt failed         |
| `RenewalSuccess`     | `subscription.updated` (rebill)     | Recurring charge succeeded     |
| `RenewalFailure`     | `subscription.past_due`             | Recurring charge failed        |
| `Cancellation`       | `subscription.cancelled`            | Subscription cancelled         |
| `Expiration`         | `subscription.expired`              | Subscription expired naturally |
| `Chargeback`         | `subscription.cancelled` + flag     | Cardholder disputed charge     |
| `Refund`             | `subscription.cancelled` + flag     | Merchant-initiated refund      |
| `BillingDateChange`  | `subscription.updated`              | Next billing date changed      |
| `CustomerDataUpdate` | (logged, no state change)           | Customer updated their info    |
| `UpgradeSuccess`     | `subscription.updated`              | Plan upgrade completed         |
| `UpSaleSuccess`      | `subscription.created` (new)        | Cross-sell/upsell completed    |

## Webhook Payload Format

CCBill webhooks (v2+) send **JSON** payloads via HTTP POST.

### Key Fields

| Field            | Description                           | Idempotency                        |
| ---------------- | ------------------------------------- | ---------------------------------- |
| `transactionId`  | Unique transaction identifier         | **YES** — use as `providerEventId` |
| `subscriptionId` | CCBill subscription identifier        | Use as `providerSubscriptionId`    |
| `clientAccnum`   | Merchant account number               |                                    |
| `clientSubacc`   | Sub-account number                    |                                    |
| `timestamp`      | Event timestamp (ISO 8601)            |                                    |
| `eventType`      | Event name (e.g., `NewSaleSuccess`)   |                                    |
| `billedAmount`   | Amount charged                        |                                    |
| `billedCurrency` | Currency code                         |                                    |
| `paymentType`    | Payment method used                   |                                    |
| `X-custom-*`     | Pass-through fields from checkout URL |                                    |

### Custom Fields Round-Trip

The `X-custom-*` parameters sent in the FlexForms checkout URL are echoed back
in the webhook payload. This is how the driver extracts:

- `X-custom-mixiUserUuid` → to identify the Miximodel user
- `X-custom-mixiSecret` → to verify the echo secret
- `X-custom-affiliateId` → to persist affiliate attribution

## Webhook Verification

CCBill offers two verification mechanisms:

### 1. Digest Verification (Recommended)

CCBill includes a digest header/field computed from the payload and a shared
secret. The driver should:

1. Read the raw request body
2. Compute the expected digest using the webhook secret
3. Compare using constant-time comparison (`crypto.timingSafeEqual`)

### 2. IP Allowlist

CCBill publishes IP ranges from which webhooks originate. This can be used as an
additional layer but should NOT be the sole verification method (IPs can
change).

CCBill webhook IP ranges documentation:
https://ccbill.com/doc/webhooks-user-guide (section "Webhooks IP Ranges")

### Miximodel's Layered Verification (matching SegPay pattern)

1. **Digest verification** on the raw body (primary)
2. **Echo secret** via `X-custom-mixiSecret` (secondary)
3. **Constant-time comparison** for all secret checks

## Webhook Configuration

Configured in CCBill Admin Portal:

1. Navigate to Account → Sub Account → Webhooks
2. Set the Webhook URL: `https://miximodel.com/api/webhooks/payment`
3. Select webhook version (v2+ for JSON)
4. Select events to receive
5. Configure the shared secret for digest verification

## Retry Policy

CCBill retries failed webhook deliveries. The merchant endpoint MUST:

- Return HTTP 200 for successful processing
- Return HTTP 4xx/5xx to trigger retry
- Handle duplicate deliveries idempotently (same `transactionId`)

## Idempotency

Use `transactionId` as the `providerEventId` for deduplication. The existing
`webhook_event_dedupe` table with `UNIQUE(provider, provider_event_id)` handles
this — same pattern as SegPay's `tranid`.

## Relevant URLs

- Webhooks Overview: https://ccbill.com/doc/webhooks-overview
- Webhooks User Guide: https://ccbill.com/doc/webhooks-user-guide
- Error Codes: https://ccbill.com/doc/error-codes
