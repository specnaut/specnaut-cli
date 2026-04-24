# SegPay — Error & Decline Codes

> **Load this when:** handling a declined transaction, mapping failure
> reasons in logs, or debugging why a postback reports `approved=No`.

## Categories

SegPay error codes fall into three families:

- **`F###`** — Fraud / Velocity / Negative Database blocks
- **`V####`** — Additional velocity rule blocks
- **`ERR###`** — Instant Conversion / One-Click system errors

All three indicate **decline** or **failure**. SegPay does not publish
codes for "approved" or "pending" states — those are conveyed via
`approved=Yes` and `standin=1` respectively in the postback.

## Velocity Errors (SPVelocity)

| Code   | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| F440   | Instant Conversion validation errors exceeded                       |
| F460   | Global velocity threshold exceeded                                  |
| F461   | Merchant/URL velocity — card number                                 |
| F462   | Merchant/URL velocity — email                                       |
| F463   | Merchant/URL velocity — IP address                                  |
| F464   | Merchant/URL velocity (additional)                                  |
| F465   | Merchant/URL velocity (additional)                                  |
| V3001  | Velocity — card number                                              |
| V3002  | Velocity — email                                                    |
| V3003  | Velocity — username                                                 |
| V3004  | Velocity — IP address                                               |
| V3005  | Velocity — device fingerprint                                       |
| V3006  | Velocity — TrueIP                                                   |
| V3007…V3012 | Additional velocity checks                                    |

## Negative Database Blocks (SPNegDB)

| Code  | Meaning                                           |
| ----- | ------------------------------------------------- |
| F451  | Card number in negative database                  |
| F452  | Email in negative database                        |
| F453  | Additional card/email negative database match     |
| F455  | Country/IP mismatch                               |
| F456  | Additional country/IP mismatch                    |
| F470  | BIN (Bank Identification Number) block            |
| F471  | Additional BIN block                              |
| F481  | MerchantPartnerID block                           |
| F493  | Merchant country block                            |
| F494  | Device database match                             |

## Other Decline Codes

| Code  | Meaning                                           |
| ----- | ------------------------------------------------- |
| F457  | Duplicate subscription                            |
| F458  | Merchant URL country/IP block                     |
| F492  | Merchant email negative database                  |

## Instant Conversion / One-Click Errors

These apply only to token-based repeat transactions:

| Code    | Meaning                                                      |
| ------- | ------------------------------------------------------------ |
| ERR301  | Token not found in the system                                |
| ERR302  | Bill configuration lacks Instant Conversion capability       |
| ERR303  | Signup transaction unauthorized                              |
| ERR304  | Purchase already converted                                   |
| ERR305  | NextDate null                                                |
| ERR306  | NextDate within cutoff window                                |
| ERR307  | Invalid package / bill configuration                         |
| ERR308  | Unsupported card type                                        |
| ERR309  | Unsupported card type (additional)                           |
| ERR310  | Purchase no longer active                                    |

## Handling Recommendations

- **F457 (Duplicate subscription)**: surface as "You already have an
  active subscription" in the UI. Do NOT prompt the user to retry —
  link them to billing settings.
- **F451 / F452 / F453 (Negative database)**: silently decline. Do
  not reveal to the user that they are in a negative database — that
  leaks security information.
- **F470 / F471 (BIN block)**: show a generic "Your card was
  declined. Please try another payment method" message.
- **F440 / F460-F465 / V####**: velocity blocks usually mean fraud
  prevention kicked in. Generic decline message; never "try again
  later" (attacker-friendly).
- **F458 / F493 (Geography block)**: show "This payment method is
  not available in your region" and suggest crypto or PayPal if
  enabled.
- **ERR301-ERR310**: these are merchant configuration bugs.
  **Alert oncall** via logger.error — users should never see them.

## Gaps

Public documentation does not include:

- Specific decline codes for "insufficient funds", "expired card",
  "CVV mismatch", etc. These likely surface under generic
  `authcode` values from the acquirer.
- Pending / stand-in codes (use `standin=1` in the postback instead).
- A mapping from SegPay codes to Visa/MC reason codes.

Ask the SegPay account manager for the full decline code reference
document if high-fidelity decline UX matters.
