# CCBill — Legacy Affiliate System Reference

> Load this file when implementing affiliate tracking, attribution, or anything
> related to CCBill's built-in affiliate program.

## Overview

CCBill's **Legacy Affiliate System (LAS)** is a native affiliate program built
into the payment processor. Unlike external affiliate networks, LAS handles:

- Affiliate registration and approval
- Tracking link generation
- Attribution through the payment flow
- Commission calculation
- Payout management

This is one of the two decisive advantages of CCBill for Miximodel (the other
being Merchant of Record status).

## How It Works

### 1. Affiliate Registration

Affiliates sign up through a CCBill-hosted portal linked to the merchant's
program. CCBill assigns each affiliate a unique **affiliate tracking code**.

### 2. Tracking Link Structure

Affiliates use tracking links that include their code. When a user clicks an
affiliate link, CCBill attributes the eventual sale to that affiliate.

The affiliate ID can be propagated via:

- CCBill's native affiliate link format
- Custom pass-through parameter (`X-custom-affiliateId`)

### 3. Attribution in the Checkout Flow

When Miximodel constructs the FlexForms checkout URL, the affiliate ID is
included:

```
https://api.ccbill.com/wap-frontflex/flexforms/{id}
  ?account=...
  &subacc=...
  &X-custom-affiliateId={affiliateCode}
  ...
```

CCBill attributes the sale to the affiliate and includes the affiliate
information in the webhook payload.

### 4. Webhook Attribution Data

The webhook payload for a `NewSaleSuccess` event includes affiliate-related
fields that the driver must extract and persist on the subscription record.

### 5. Commission & Payout

CCBill handles:

- Commission calculation based on configured rates
- Payout scheduling and execution
- Affiliate reporting and dashboards

Miximodel does NOT need to build a payout system.

## Miximodel Integration Points

### Inbound: Capturing the Affiliate ID

When a user arrives at Miximodel via an affiliate link, the frontend captures
the affiliate ID from the URL query parameter and persists it (cookie, session,
or URL state) until checkout.

### Checkout: Propagating to FlexForms

The driver receives the affiliate ID via `CheckoutOptions` and embeds it in the
FlexForms URL as `X-custom-affiliateId`.

### Webhook: Persisting Attribution

When the `NewSaleSuccess` webhook arrives, the driver extracts
`X-custom-affiliateId` from the custom fields and includes it in the
`NormalizedWebhookEvent.metadata` (or a dedicated field) so `WebhookService` can
persist it on the subscription.

### Reporting

Affiliate performance is visible in CCBill's admin portal. Miximodel does NOT
need a separate affiliate dashboard (MVP).

## Key Design Decision

The affiliate ID round-trips through the CCBill flow as a pass-through
parameter. This means:

1. **No conditional logic in shared code.** The affiliate ID is just another
   field in `CheckoutOptions` and `NormalizedWebhookEvent`.
2. **No CCBill-specific affiliate API calls.** Attribution is handled natively
   by CCBill.
3. **The `PaymentContract` abstraction is not affected.** A future processor
   without native affiliates would simply ignore the affiliate field or use a
   different mechanism inside its own driver.

## Relevant URLs

- Legacy Affiliate System: https://ccbill.com/doc/legacy-affiliate-system
- Partners: https://ccbill.com/partners
