# SegPay — SRS (Segpay Reporting Service)

> **Load this when:** implementing programmatic cancel/refund, writing
> reconciliation jobs, or debugging missing postbacks via query.

## What SRS Is

SRS is a pair of **SOAP web services** exposed by SegPay:

1. **Reporting Service** — query transaction / subscription data.
2. **Administrative Service** — consumer support operations (cancel, refund,
   block, reactivate).

SOAP, HTTPS only, authenticated with:

- `SRS User ID`
- `User Access Key`

Unauthenticated requests are rejected. Plain HTTP is rejected. WSDL is published
at specific endpoints (not publicly documented — request via account manager
during onboarding).

Live portal: **https://srs.segpay.com/**

## Recommended Usage (vs Postbacks)

SegPay's own guidance: "use reporting services in conjunction with the postback
notification system." In practice:

- **Postbacks** = primary, real-time event stream.
- **SRS** = secondary, for:
  - Reconciliation (catch-up if a postback was missed)
  - Programmatic cancellations initiated from Miximodel UI
  - Refunds initiated from admin tooling
  - Daily revenue reports / dashboards
  - Consumer support tooling (cancel on user request)

**Data is available the day after** for reports ("previous day's transactions
only"). The system operates on **GMT**.

## Data Available via SRS (vs Postbacks)

SRS exposes fields that are **not** available via postbacks:

- Purchase status (active / cancelled / expired / etc.)
- IP country
- BIN country
- Retry counts (for rebills)
- Refund reason codes and comments
- Custom merchant variables (`REF1`–`REF10`)

Use SRS to **back-fill** missing data when a postback arrives without these
fields.

## Operations (inferred — verify with WSDL)

Based on documented capabilities, expect at minimum:

| Operation                | Purpose                                |
| ------------------------ | -------------------------------------- |
| `GetTransactionHistory`  | List transactions for a consumer       |
| `GetSubscriptionDetails` | Fetch a subscription by ID             |
| `CancelSubscription`     | Cancel a subscription                  |
| `ExpireSubscription`     | Mark subscription expired immediately  |
| `RefundTransaction`      | Refund a specific transaction          |
| `VoidTransaction`        | Void (pre-settlement reversal)         |
| `BlockConsumer`          | Add consumer to negative database      |
| `GetRevenueSummary`      | Revenue reports by source / date range |

**Exact operation names, parameters, and return shapes are in the WSDL** — do
not rely on the names above. Fetch the WSDL first and generate a typed client
(or hand-write with verified shapes).

## Implementation Guidance for `SegPayDriver`

### Client choice

- **Option A**: Use a minimal SOAP library (e.g. `strong-soap`,
  `easy-soap-request`) to send hand-crafted envelopes.
- **Option B**: Hand-craft XML + `fetch()`. Fine for 3-4 operations; unwieldy
  beyond that.
- **Option C**: Generate a typed client from the WSDL once and commit the
  generated output (keeps build deterministic).

**Recommended**: Option B for MVP (cancel + refund + get), migrate to Option C
if SRS usage grows.

### Credential handling

- Never expose `SEGPAY_SRS_USER_ID` / `SEGPAY_SRS_ACCESS_KEY` outside the
  driver.
- No SRS calls from controllers, services, or listeners.
- Wrap every SRS call in a **timeout** (default 15s) and a **retry policy** (2
  retries, exponential backoff). SOAP endpoints can be slow.

### Cancellation flow

```
User clicks "Cancel subscription" in billing settings
  ↓
Controller calls PaymentContract.cancelSubscription(subscription)
  ↓
SegPayDriver.cancelSubscription calls SRS CancelSubscription
  ↓
SRS returns success
  ↓
Controller updates UI optimistically (status → 'cancelling')
  ↓
SegPay sends cancellation postback (seconds to minutes later)
  ↓
WebhookService applies canonical 'subscription.cancelled'
  ↓
UI state catches up to 'cancelled'
```

**Important**: the SRS call is a _hint_. The postback is the _source of truth_.
Never set the status to `cancelled` purely from the SRS response — wait for the
postback to confirm.

### Reconciliation job (future)

A nightly job can query SRS for all subscription status changes on the previous
GMT day and reconcile against the Miximodel database. Any subscription whose SRS
status differs from the DB status was likely the victim of a missed postback —
log, alert, and correct.

## Alternative: Consumer Self-Service Portal

If programmatic cancel is too complex for MVP, fall back to linking users to the
SegPay consumer portal:

```
https://cs.segpay.com/
```

Users can view transactions, cancel memberships, and update cards there. UX is a
handoff to SegPay — not ideal but zero engineering cost.

**Miximodel recommendation**: implement programmatic cancel via SRS (better UX),
but keep the cs.segpay.com link as a documented fallback in help content.

## References

- SRS portal: https://srs.segpay.com/
- Consumer self-service: https://cs.segpay.com/
- Developer guide entry:
  https://gethelp.segpay.com/docs/Content/DeveloperDocs/SRS-Developer.htm
- SRS reports chart:
  https://gethelp.segpay.com/docs/Content/DeveloperDocs/ProcessingAPI/09-SRS%20Web%20Service%20Reports.htm
