# CCBill — FlexForms & Dynamic Pricing Reference

> Load this file when building or debugging the checkout URL, working with
> dynamic pricing, or configuring FlexForms.

## What is FlexForms?

FlexForms is CCBill's **hosted payment page** system. Instead of handling card
data, Miximodel redirects the user to a CCBill-hosted page where they complete
payment. This is the PCI-compliant integration path — Miximodel never touches
card numbers.

## FlexForms URL Structure

```
https://api.ccbill.com/wap-frontflex/flexforms/{flexformsId}
  ?account={accountNumber}
  &subacc={subAccountNumber}
  &currencyCode={currencyCode}
  &initialPrice={initialPrice}
  &initialPeriod={initialPeriod}
  &recurringPrice={recurringPrice}
  &recurringPeriod={recurringPeriod}
  &numRebills={numRebills}
  &formDigest={formDigest}
  &X-custom-mixiUserUuid={userId}
  &X-custom-mixiSecret={secret}
  &X-custom-affiliateId={affiliateId}
```

### Required Parameters

| Parameter         | Description                         | Example       |
| ----------------- | ----------------------------------- | ------------- |
| `account`         | Merchant account number             | `123456`      |
| `subacc`          | Sub-account number                  | `0001`        |
| `currencyCode`    | ISO 4217 numeric (978=EUR, 840=USD) | `978`         |
| `initialPrice`    | First billing amount                | `19.00`       |
| `initialPeriod`   | Days until first rebill             | `30`          |
| `recurringPrice`  | Rebill amount                       | `19.00`       |
| `recurringPeriod` | Days between rebills                | `30`          |
| `numRebills`      | Total rebills (99=infinite)         | `99`          |
| `formDigest`      | MD5 verification digest (see below) | `a1b2c3d4...` |

### Custom Pass-Through Parameters

Use the `X-custom-*` prefix to pass arbitrary data through the checkout flow.
These values appear in webhook payloads, allowing the driver to associate the
payment with a Miximodel user.

Key pass-through fields for Miximodel:

- `X-custom-mixiUserUuid` — the Miximodel user UUID
- `X-custom-mixiSecret` — shared secret for echo verification
- `X-custom-affiliateId` — affiliate tracking ID (if present)

## Dynamic Pricing & formDigest

Dynamic pricing lets Miximodel set custom prices at checkout time instead of
using pre-configured price points in the admin portal.

### Digest Calculation

```
formDigest = MD5(
  initialPrice +
  initialPeriod +
  recurringPrice +
  recurringPeriod +
  numRebills +
  currencyCode +
  salt
)
```

- **salt**: Configured in CCBill admin under the sub-account's dynamic pricing
  settings. Stored as `CCBILL_SALT` env var.
- **All values are concatenated as strings** without separators.
- The digest MUST be computed **server-side**. Never expose the salt to the
  frontend.

### Example

For monthly Pro at EUR 19.00:

```
initialPrice   = "19.00"
initialPeriod  = "30"
recurringPrice = "19.00"
recurringPeriod= "30"
numRebills     = "99"
currencyCode   = "978"
salt           = "abc123secret"

concat = "19.003019.003099978abc123secret"
formDigest = MD5(concat) = "e4d909c290d0fb1ca068..."
```

### For Yearly Plans

```
initialPrice   = "99.00"
initialPeriod  = "365"
recurringPrice = "99.00"
recurringPeriod= "365"
numRebills     = "99"
currencyCode   = "978"
```

## Currency Codes (ISO 4217 Numeric)

| Code | Currency |
| ---- | -------- |
| 978  | EUR      |
| 840  | USD      |
| 826  | GBP      |
| 036  | AUD      |
| 124  | CAD      |
| 392  | JPY      |

## FlexForms Admin Setup

1. Log into CCBill Admin Portal
2. Navigate to FlexForms Systems
3. Create a new payment flow
4. Configure the form appearance and fields
5. Note the `flexformsId` — this goes into `CCBILL_FLEXFORMS_ID`
6. Enable dynamic pricing on the sub-account
7. Set the dynamic pricing salt — this goes into `CCBILL_SALT`

## Return URLs

After payment, CCBill redirects the user to the configured return URL.
Pass-through parameters are appended. The return URL is a **UX hint only** — the
webhook is the source of truth.

Configure `CCBILL_RETURN_URL` (e.g.,
`https://miximodel.com/settings/billing?status=success`).

## Relevant URLs

- FlexForms Overview: https://ccbill.com/doc/flexforms-overview
- Dynamic Pricing Guide: https://ccbill.com/doc/dynamic-pricing-user-guide
- General References (currency codes):
  https://ccbill.com/doc/general-references-and-resources
