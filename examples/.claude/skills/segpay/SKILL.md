---
name: segpay
description: SegPay payment processor integration knowledge base for Miximodel. Use when the user asks to integrate, debug, test, or discuss anything SegPay-related — hosted checkout (Signup URL), postbacks, SRS SOAP operations, signature verification, refund/cancel workflows, dispute alerts (CDA), RDR, TC40, stand-in processing, crypto, multi-currency, merchant onboarding, or the pluggable payment-processor abstraction. Trigger on "segpay", "postback", "SRS", "signup url", "price point", "package id", "merchant id", "cancel subscription", "chargeback", "dispute alert", "RDR", "TC40", "stand-in", "rebill".
---

# SegPay — Miximodel Knowledge Base

Integration guide, operational FAQ, and architectural rules for
SegPay as Miximodel's concrete implementation of the `PaymentContract`
Strategy Pattern.

## Core Principles (always in context)

1. **`PaymentContract` is the single abstraction.** All SegPay code
   lives in `app/services/payment/segpay_driver.ts`. No business
   logic, service, controller, or Inertia page may depend on a
   concrete driver.
2. **Postbacks are the source of truth.** Browser return URLs are
   UX hints. If the two disagree, the postback wins.
3. **Postbacks are `application/x-www-form-urlencoded`, not JSON.**
   Parse the raw body appropriately.
4. **Idempotency is mandatory.** Deduplicate on `tranid`.
5. **Test Mode is identified by `TESTTRANS=1`.** Filter it out in
   production.
6. **Configuration is namespaced under `SEGPAY_*`.** Never rename
   for a future processor.
7. **Zero references to Lemon Squeezy** in runtime code once
   spec 177 is complete.

## Load-on-Demand References

Read only what the current task requires. Each file is self-contained.

| When the task involves…                                  | Read                              |
| -------------------------------------------------------- | --------------------------------- |
| Implementing/reviewing the driver or abstraction         | `references/architecture.md`      |
| Postback handler, parameters, normalization, debugging   | `references/postbacks.md`         |
| Signup URL construction, hosted checkout parameters      | `references/postbacks.md` + `references/payment-options.md` |
| SRS SOAP (cancel, refund, query, reconciliation)         | `references/srs.md`               |
| Sandbox setup, test cards, functional tests              | `references/testing.md`           |
| Decline / fraud / one-click error codes                  | `references/error-codes.md`       |
| Payment methods, One-Click, Instant Conversion, Stand-In | `references/payment-options.md`   |
| Multi-currency, languages, VAT questions                 | `references/i18n.md`              |
| CDA, RDR, TC40, refund/cancel semantics, settlement      | `references/faq-operations.md`    |
| Merchant account application, docs to prepare, rates     | `references/onboarding.md`        |

## Routing Rules

- **Question about "how does X work in SegPay?"** → load
  `faq-operations.md` first; if not there, the topic-specific
  reference.
- **Question about "how do I implement X in the driver?"** → load
  `architecture.md` first, then the topic reference.
- **Question about "why is my postback not working?"** → load
  `postbacks.md` + `testing.md`.
- **Question about "can we add another processor later?"** → load
  `architecture.md` and follow the Paper-Exercise Test.
- **"Kevin asks how to apply to SegPay"** → load `onboarding.md`.
- **Error code starting with `F`, `V`, or `ERR`** → load
  `error-codes.md`.

## Integration Model (one-paragraph recap)

SegPay is a **hosted-checkout + postback** processor. Miximodel
redirects the user to a SegPay Signup URL with merchant + package +
pass-through parameters. The user completes payment on SegPay's
hosted page. SegPay sends a server-to-server **form-urlencoded
postback** to `POST /api/webhooks/payment` for every lifecycle event
(new sale, rebill, cancel, expire, chargeback, refund, RDR reversal).
Cancellations and refunds initiated by Miximodel go through the
**SRS SOAP Admin service**. See `references/architecture.md` for the
full diagram and rules.

## Environment Variables (namespaced)

| Variable                        | Purpose                                     |
| ------------------------------- | ------------------------------------------- |
| `SEGPAY_MERCHANT_ID`            | Root merchant account identifier            |
| `SEGPAY_PACKAGE_ID_MONTHLY_PRO` | Package ID for monthly Pro plan             |
| `SEGPAY_PACKAGE_ID_YEARLY_PRO`  | Package ID for yearly Pro plan              |
| `SEGPAY_POSTBACK_USERNAME`      | HTTP Basic Auth username on postback URL    |
| `SEGPAY_POSTBACK_PASSWORD`      | HTTP Basic Auth password on postback URL    |
| `SEGPAY_POSTBACK_SECRET`        | Shared secret echoed via `extra` field      |
| `SEGPAY_SRS_USER_ID`            | SRS SOAP auth — user id                     |
| `SEGPAY_SRS_ACCESS_KEY`         | SRS SOAP auth — access key                  |
| `SEGPAY_SIGNUP_URL_BASE`        | Base URL of the hosted checkout page        |
| `SEGPAY_RETURN_URL`             | Post-checkout return URL                    |
| `SEGPAY_TEST_MODE`              | `true` in dev/sandbox, `false` in prod      |

All declared in `start/env.ts`, `.env.example`, and
`infrastructure/resources/secrets.ts`; wired into `cloudrun.ts`; set
in both Pulumi and Cloud Build.

## Quick Links

- Merchant Portal: https://mp.segpay.com/
- SRS portal: https://srs.segpay.com/
- Consumer self-service: https://cs.segpay.com/
- FAQ landing: https://segpay.com/csfaq/
- Developer docs: https://gethelp.segpay.com/docs/Content/DeveloperDocs/DeveloperDocs.htm
- Tech support: `techsupport@segpay.com`

## Project Artifacts

- Spec: `specs/177-segpay-integration/spec.md`
- Backlog: `tasks/backlog/026-segpay-integration.md`
- Contract: `app/contracts/payment.ts`
- Driver (to be created): `app/services/payment/segpay_driver.ts`
- Registry (to be created): `app/contracts/payment_providers.ts`
