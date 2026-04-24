---
name: ccbill
description: CCBill payment processor integration knowledge base for Miximodel. Use when the user asks to integrate, debug, test, or discuss anything CCBill-related — FlexForms checkout, webhooks (Background Posts), RESTful Transaction API, OAuth2 auth, dynamic pricing, Legacy Affiliate System, payment tokens, subscription management, DataLink, merchant onboarding, or the pluggable payment-processor abstraction. Trigger on "ccbill", "flexforms", "background post", "webhook ccbill", "affiliate", "legacy affiliate", "dynamic pricing", "payment token", "DataLink", "sub-account", "merchant of record", "cascade", "formDigest".
---

# CCBill — Miximodel Knowledge Base

Integration guide, operational FAQ, and architectural rules for
CCBill as Miximodel's **default** concrete implementation of the
`PaymentContract` Strategy Pattern.

## Strategic Context

CCBill is the **preferred** payment processor for Miximodel (task `029`).
Two decisive advantages for a solo founder:

1. **Merchant of Record** — CCBill handles international VAT collection
   and remittance automatically. No per-country VAT registration.
2. **Native Affiliate Program** — Built-in "Legacy Affiliate System"
   with attribution, tracking, and payouts inside the processor.

SegPay remains a first-class fallback driver. Switching back is a
one-line IoC change in `providers/payment_provider.ts`.

## Core Principles (always in context)

1. **`PaymentContract` is the single abstraction.** All CCBill code
   lives in `app/services/payment/ccbill_driver.ts`. No business
   logic, service, controller, or Inertia page may depend on a
   concrete driver.
2. **Webhooks are the source of truth.** Browser return URLs are UX
   hints. If the two disagree, the webhook wins.
3. **Webhooks are JSON** (v2+). Verify via digest or IP allowlist.
4. **Idempotency is mandatory.** Deduplicate on `transactionId`.
5. **Dynamic pricing uses MD5 digest.** The `formDigest` MUST be
   computed server-side; never expose the salt to the client.
6. **Affiliate IDs must round-trip.** From inbound URL → checkout
   URL → webhook payload → persisted subscription.
7. **Configuration is namespaced under `CCBILL_*`.** Never rename
   for a future processor.
8. **Zero conditional branches outside the driver.** No
   `if (provider === 'ccbill')` in shared code.

## Load-on-Demand References

Read only what the current task requires. Each file is self-contained.

| When the task involves...                                    | Read                          |
| ------------------------------------------------------------ | ----------------------------- |
| Implementing/reviewing the driver or abstraction             | `references/architecture.md`  |
| FlexForms checkout URL, dynamic pricing, form digest         | `references/flexforms.md`     |
| Webhook handler, events, payload, verification               | `references/webhooks.md`      |
| RESTful Transaction API, OAuth2, payment tokens              | `references/api.md`           |
| Affiliate tracking, attribution, Legacy Affiliate System     | `references/affiliate.md`     |
| Decline / fraud / error codes                                | `references/error-codes.md`   |
| Admin portal, reports, DataLink                              | `references/admin-reporting.md` |
| PCI DSS, AVS, fraud prevention, security                    | `references/security-fraud.md` |
| Merchant account application, onboarding, contact            | `references/onboarding.md`    |
| FAQ, glossary, operational knowledge, cascade                | `references/faq-operations.md` |

## Routing Rules

- **"How does X work in CCBill?"** → `faq-operations.md` first; if
  not there, the topic-specific reference.
- **"How do I implement X in the driver?"** → `architecture.md`
  first, then the topic reference.
- **"Why is my webhook not working?"** → `webhooks.md` +
  `error-codes.md`.
- **"Can we add another processor later?"** → `architecture.md`
  and the Paper-Exercise Test.
- **"How to apply to CCBill?"** → `onboarding.md`.
- **Error code starting with `100` or `200`** → `error-codes.md`.
- **"How do affiliates work?"** → `affiliate.md`.
- **"How to build the checkout URL?"** → `flexforms.md`.

## Integration Model (one-paragraph recap)

CCBill is a **hosted-checkout + webhook** processor. Miximodel
constructs a FlexForms URL with account, sub-account, pricing, and
pass-through parameters (including affiliate ID and user UUID).
The user completes payment on CCBill's hosted FlexForms page. CCBill
sends a server-to-server **JSON webhook** to `POST /api/webhooks/payment`
for every lifecycle event (NewSaleSuccess, RenewalSuccess, Cancellation,
Chargeback, Refund, Expiration, etc.). Cancellations and refunds
initiated by Miximodel go through the **RESTful Transaction API** or
**DataLink**. See `references/architecture.md` for the full diagram.

## Environment Variables (namespaced)

| Variable                           | Purpose                                          |
| ---------------------------------- | ------------------------------------------------ |
| `CCBILL_ACCOUNT_NUMBER`            | Main merchant account number                     |
| `CCBILL_SUB_ACCOUNT_NUMBER`        | Sub-account for Miximodel subscriptions          |
| `CCBILL_FLEXFORMS_ID`              | FlexForms payment flow ID                        |
| `CCBILL_SALT`                      | Salt for dynamic pricing formDigest (MD5)        |
| `CCBILL_WEBHOOK_SECRET`            | Shared secret for webhook verification           |
| `CCBILL_API_CLIENT_ID`             | OAuth2 client ID for RESTful API                 |
| `CCBILL_API_CLIENT_SECRET`         | OAuth2 client secret for RESTful API             |
| `CCBILL_AFFILIATE_ENABLED`         | Enable/disable affiliate parameter propagation   |
| `CCBILL_RETURN_URL`                | Post-checkout return URL                         |
| `CCBILL_TEST_MODE`                 | `true` in dev/sandbox, `false` in prod           |

All declared in `start/env.ts`, `.env.example`, and
`infrastructure/resources/secrets.ts`; wired into `cloudrun.ts`; set
in both Pulumi and Cloud Build.

## Quick Links — Official Documentation

> **Note:** Many CCBill doc pages are client-side rendered. If
> WebFetch returns empty content, the agent should note this and
> either use the reference summaries below or try alternative URLs.

### Core Integration
- FlexForms Overview: https://ccbill.com/doc/flexforms-overview
- Webhooks Overview: https://ccbill.com/doc/webhooks-overview
- Webhooks User Guide: https://ccbill.com/doc/webhooks-user-guide
- RESTful Transaction API: https://ccbill.com/doc/ccbill-restful-transaction-api
- RESTful API Resources: https://ccbill.com/doc/ccbill-restful-api-resources
- API Guide: https://ccbill.com/doc/ccbill-api-guide
- Create Payment Token (non-3DS): https://ccbill.com/doc/create-payment-token-non-3ds
- Dynamic Pricing: https://ccbill.com/doc/dynamic-pricing-user-guide
- Error Codes: https://ccbill.com/doc/error-codes

### Affiliate System
- Legacy Affiliate System: https://ccbill.com/doc/legacy-affiliate-system

### Admin & Reporting
- Admin Portal FAQ: https://ccbill.com/doc/admin-portal-faq
- Merchant Transactions Report: https://ccbill.com/doc/merchant-transactions-report
- Account Change Forms: https://ccbill.com/doc/account-change-forms
- Promotion & Discount Systems: https://ccbill.com/doc/promotion-and-discount-systems

### Reference & General
- General References: https://ccbill.com/doc/general-references-and-resources
- Glossary: https://ccbill.com/doc/glossary-of-payment-processing-terms
- Accepted Payment Methods: https://ccbill.com/doc/accepted-payment-methods
- FAQ: https://ccbill.com/doc/frequently-asked-questions
- Cascade for SegPay Users: https://ccbill.com/doc/cascade-setup-for-segpay-users

### Knowledge Base (Security & Fraud)
- PCI DSS: https://ccbill.com/kb/pci-dss
- AVS Mismatch: https://ccbill.com/kb/avs-mismatch-rejected
- BIN Attack: https://ccbill.com/kb/bin-attack
- Address Fraud: https://ccbill.com/kb/address-fraud
- Soft vs Hard Decline: https://ccbill.com/kb/soft-decline-vs-hard-decline
- Authorization Hold: https://ccbill.com/kb/authorization-hold
- Card on File: https://ccbill.com/kb/card-on-file
- Tokenization: https://ccbill.com/kb/credit-card-tokenization
- Merchant ID: https://ccbill.com/kb/merchant-id
- Liability Shift: https://ccbill.com/kb/successful-liability-shift-for-enrolled-card-is-required

### Knowledge Base (Technical)
- SDK vs API: https://ccbill.com/kb/sdk-vs-api
- OAuth: https://ccbill.com/kb/what-is-oauth
- Bearer Auth: https://ccbill.com/kb/authorization-bearer
- API Key: https://ccbill.com/kb/what-is-an-api-key
- API Endpoint: https://ccbill.com/kb/what-is-an-api-endpoint
- cURL Basic Auth: https://ccbill.com/kb/curl-basic-auth
- 2FA: https://ccbill.com/kb/what-is-two-factor-authentication

### Partners & Contact
- Partners: https://ccbill.com/partners
- Contact: https://ccbill.com/contact
- Support: merchantsupport@ccbill.com

## Project Artifacts

- Backlog: `tasks/backlog/029-switch-default-payment-processor-to-ccbill.md`
- Contract: `app/contracts/payment.ts`
- Registry: `app/contracts/payment_providers.ts`
- Driver (to be created): `app/services/payment/ccbill_driver.ts`
- SegPay driver (fallback): `app/services/payment/segpay_driver.ts`
- Payment playbook: `docs/payment-processors.md`
- **Local dev fake driver**: `docs/commerce/fake-processor.md` — the
  `FakeProcessorDriver` subclasses this one to reuse the inherited
  HMAC verifier and webhook normalization. Use it to exercise
  paywalled features end-to-end without real CCBill credentials.
