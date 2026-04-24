# SegPay — Postbacks (complete reference)

> **Load this when:** implementing the postback endpoint, writing or debugging
> `SegPayDriver.normalizeWebhook`, or investigating a missing/duplicate/tampered
> postback.

## Transport & Format

- **Method**: HTTP POST (inferred; not explicitly stated in the public docs —
  confirm during onboarding).
- **Body**: `application/x-www-form-urlencoded`. **Never parse as JSON.**
- **Transport**: HTTPS only. SegPay adds the `https://` prefix automatically
  when the merchant configures the URL in the portal.
- **URL configuration**: Merchant Portal → **My Websites → Manage Postbacks**.
  Up to **four transaction postbacks** may be configured simultaneously (useful
  for staging environments).

## Expected Merchant Response

The response contract depends on the postback type:

| Postback type  | Category    | Response required                                  |
| -------------- | ----------- | -------------------------------------------------- |
| Inquiry        | Member Mgmt | Plain text (e.g. `GOOD` / `BAD`) — **synchronous** |
| Access Enable  | Member Mgmt | Plain text (e.g. `GOOD` / `BAD`) — **synchronous** |
| Access Disable | Member Mgmt | Plain text (e.g. `GOOD` / `BAD`) — **synchronous** |
| Cancellation   | Member Mgmt | Plain text (e.g. `GOOD` / `BAD`) — **synchronous** |
| Reactivation   | Member Mgmt | Plain text (e.g. `GOOD` / `BAD`) — **synchronous** |
| Transaction    | Txn         | HTTP status code per RFC 2616 — **asynchronous**   |

**Plain text rules** (Member Management only):

- No spaces, line breaks, HTML, or special characters
- Case-insensitive
- Expected/error strings are configurable per postback

**Miximodel choice**: we must decide whether to consume both categories.
Transaction postbacks are enough for most lifecycle events — Member Management
postbacks are useful if we want to block login synchronously on cancellation.

## Retry Behavior

| Category    | Retry interval | Max duration |
| ----------- | -------------- | ------------ |
| Member Mgmt | 5 minutes      | 1 hour       |
| Transaction | 1 hour         | 12 hours     |

Retry is **opt-in** per postback configuration; enabling it also enables failure
email notifications. **Enable retry in production.**

## Security / Authenticity (the missing piece)

**⚠️ CRITICAL GAP**: the public documentation does **not** describe any HMAC,
signature, shared-secret header, or explicit IP allowlist mechanism for postback
verification. Known options:

1. **HTTP Basic Auth on the endpoint** — SegPay postback config accepts optional
   `Domain`, `Username`, `Password` fields to hit password-protected scripts.
   **This is the documented security primitive.**
2. **IP allowlist** — plausible but not documented publicly. Confirm SegPay's
   egress IP range with the account manager.
3. **Shared secret passed in a custom `extra` field** — viable workaround:
   include a secret token in the Signup URL (`extra secrettoken=XYZ`), which
   SegPay echoes back in the postback. Verify on arrival.
4. **Transaction ID + amount lookup** — weak; only rules out random noise, not a
   motivated attacker who knows the schema.

**Miximodel recommendation** (to validate with SegPay support):

- **Layer 1**: HTTP Basic Auth on the postback endpoint — set a strong
  credential in the SegPay merchant portal, accept only requests matching it.
- **Layer 2**: A secret token echoed via `extra mixi_secret=...` in the Signup
  URL, verified against `SEGPAY_POSTBACK_SECRET` on arrival.
- **Layer 3**: IP allowlist at the Cloud Run / edge layer once SegPay provides
  the egress range.

Document this decision in the driver with a big comment explaining why — future
contributors will ask.

## Postback Parameters — Complete Field Reference

### Transaction identifiers

| Field           | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `tranid`        | Transaction identifier — **the idempotency key**            |
| `purchaseid`    | Purchase identifier — **the subscription lookup key**       |
| `transguid`     | Global Unique Identifier for conversion tracking            |
| `relatedtranid` | Original transaction ID (on refunds / chargebacks)          |
| `eticketid`     | Package + bill config identifier                            |
| `urlid`         | Website ID inside SegPay                                    |
| `TESTTRANS`     | `1` if the transaction is in Test Mode; absent in Live Mode |

### Event / lifecycle

| Field                   | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `action`                | Event that triggered the postback (Transaction / Inquiry / Enable / Disable / Cancellation / Reactivation) |
| `stage`                 | `Initial`, `Conversion`, `Rebill`, `Instantconversion`                                                     |
| `trantype`              | `Sale`, `Credit`, `Charge`, `CB Reversal`, `RDRreversal`                                                   |
| `approved`              | `Yes` / `No`                                                                                               |
| `authcode`              | Authorization response code                                                                                |
| `standin`               | Stand-in indicator (`1` occurred, `0` did not, `-1` unsupported)                                           |
| `lastbilldate`          | Last (re)activation billing date                                                                           |
| `nextbilldate`          | Next scheduled rebill date                                                                                 |
| `transtime`             | Transaction date/time (URL-encoded, GMT)                                                                   |
| `reactivationtimestamp` | GMT date/time of reactivation                                                                              |

### Amounts

| Field          | Description                                     |
| -------------- | ----------------------------------------------- |
| `price`        | Transaction amount                              |
| `authprice`    | Converted amount per base currency              |
| `authcurrency` | Currency used for amount verification           |
| `currencycode` | Transaction currency (`USD`, `EUR`, `GBP`, ...) |
| `ival`         | Initial transaction amount                      |
| `iint`         | Initial billing period length (days)            |
| `rval`         | Recurring billing amount                        |
| `rint`         | Recurring period length (days)                  |

### Consumer / billing

| Field                                          | Description                |
| ---------------------------------------------- | -------------------------- |
| `billname`, `billnamefirst`, `billnamelast`    | Customer name              |
| `billemail`                                    | Customer email             |
| `billphone`                                    | Customer phone             |
| `billaddr`, `billcity`, `billstate`, `billzip` | Billing address            |
| `billcntry`                                    | Billing country (ISO)      |
| `ipaddress`                                    | Customer IP address        |
| `ccbincountry`                                 | Card BIN country code      |
| `cardtype`                                     | Card brand                 |
| `ccfirst6`, `cclast4`                          | Card digits (config-gated) |
| `paymentaccountid`                             | Secure card identifier     |
| `prepaidindicator`                             | `Y` / `N`                  |

### Cancel / refund metadata

| Field              | Description                 |
| ------------------ | --------------------------- |
| `cancelledby`      | Name of cancelling party    |
| `cancelcomment`    | Cancellation notes          |
| `cancelreasoncode` | Cancellation reason code    |
| `refundedby`       | Party processing the refund |
| `refundcomment`    | Refund notes                |
| `refundreasoncode` | Refund reason code          |

### Security / compliance

| Field                   | Description                             |
| ----------------------- | --------------------------------------- |
| `3DSauthenticated`      | 3-D Secure outcome (`Yes` / `No`)       |
| `3DSauthenticationtype` | Type of 3-D Secure used (reserved)      |
| `SCArequired`           | Strong Customer Authentication required |

### Merchant-defined pass-through

| Field                          | Description                                               |
| ------------------------------ | --------------------------------------------------------- |
| `extra username`               | Username captured on the pay page                         |
| `extra template`               | Pay-page template used                                    |
| `extra platform`               | Identified platform                                       |
| `extra ismobiledevice`         | Mobile device origin                                      |
| `extra browser type`/`version` | Browser information                                       |
| `extra ipcountry`              | IP country code                                           |
| `extra merchantpartnerid`      | Affiliate ID for fraud detection                          |
| `extra ref1` … `extra ref10`   | Arbitrary merchant reference variables                    |
| `extra xxxx`                   | **Any** custom variable passed in the original signup URL |

### Miscellaneous

| Field            | Description                                        |
| ---------------- | -------------------------------------------------- |
| `desc`           | Bill configuration description                     |
| `xsellnum`       | Cross-sell index (`0` main, `1` first x-sell, ...) |
| `singleusepromo` | Single-use promotion association                   |

## Canonical Event Mapping

Map SegPay action+stage+trantype combinations to Miximodel's canonical events:

| SegPay signal                                          | Canonical type                             |
| ------------------------------------------------------ | ------------------------------------------ |
| `action=Transaction`, `stage=Initial`, `trantype=Sale` | `subscription.created`                     |
| `action=Transaction`, `stage=Rebill`, `trantype=Sale`  | `subscription.updated` (renewal)           |
| `action=Transaction`, `stage=Conversion`               | `subscription.updated`                     |
| `action=Transaction`, `trantype=Credit`                | `subscription.updated` (refunded)          |
| `action=Transaction`, `trantype=CB Reversal`           | `subscription.past_due` + chargeback audit |
| `action=Transaction`, `trantype=RDRreversal`           | `subscription.updated` (refunded)          |
| `action=Cancellation`                                  | `subscription.cancelled`                   |
| `action=Access Disable` (cancel/expire)                | Feature revoke                             |
| `action=Access Enable` (post-payment)                  | Feature grant                              |
| `action=Reactivation`                                  | `subscription.created` or `updated`        |
| `action=Inquiry`                                       | Audit only                                 |

> **Chargebacks vs cancellations**: store chargebacks under a distinct internal
> audit status. Folding them silently into `cancelled` hides fraud signal.

## Handler Checklist (for `POST /api/webhooks/payment`)

1. **Read the raw bytes** via `ctx.request.raw()` — before any parser mutates
   the body. Needed for both logging and future signature verification.
2. **Authenticate** via the chosen mechanism (Basic Auth + secret token echo).
   Reject non-authentic requests with `401`, log via `logger.warn`.
3. **Hand off to `SegPayDriver.normalizeWebhook(rawBody, headers)`** — which
   returns a `NormalizedWebhookEvent` or throws.
4. **Check idempotency** against `tranid` in a dedicated table or Redis set.
   Duplicate → return `200` without mutation.
5. **Reject Test Mode postbacks in production** (check `TESTTRANS=1`).
6. **Look up the subscription** by
   `(provider = 'segpay', providerSubscriptionId = purchaseid)`.
7. **Apply the canonical state transition** via `WebhookService`.
8. **Return 200 fast.** Offload notifications/analytics to the event bus.

## Known Pitfalls

- **Form-urlencoded, not JSON.** Handling the postback body as JSON silently
  produces empty objects.
- **Return URL ≠ source of truth.** The postback is authoritative.
- **`purchaseid` vs `tranid`** — `purchaseid` identifies the subscription root
  (stable across rebills), `tranid` identifies one specific transaction (changes
  per event). Use the right key for the right lookup.
- **First-transaction reconciliation** — on `stage=Initial`, the subscription
  does not yet exist in Miximodel. Use the pass-through user UUID
  (`extra mixi_user_uuid=...`) to resolve the user.
- **Chargebacks after cancellation** — a cancelled subscription can still
  receive a `CB Reversal` or `RDRreversal` months later. Keep subscription
  records forever, never hard-delete.
- **GMT timestamps** — `transtime`, `reactivationtimestamp`, and SRS reports all
  use GMT. Convert carefully.
- **`TESTTRANS=1`** — test-mode postbacks should never touch production
  subscription state. Filter in the driver.
