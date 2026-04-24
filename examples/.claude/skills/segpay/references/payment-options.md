# SegPay — Payment Methods & Options

> **Load this when:** deciding which payment methods to enable, configuring
> packages, or debating Instant Conversion / One-Click.

## Supported Payment Methods

Based on public documentation + testing guide:

| Method         | Recurring | Refundable | Notes                                                                 |
| -------------- | :-------: | :--------: | --------------------------------------------------------------------- |
| Credit card    |    ✅     |     ✅     | Primary method. All major brands.                                     |
| PayPal         |    ⚠️     |     ✅     | Recurring support via PayPal billing agreements (verify with SegPay). |
| Cryptocurrency |    ❌     |     ❌     | **One-time only. Final.** 10 coins supported.                         |

**Cryptocurrencies**: BTC, BCH, DASH, ETH, LTC, PROPT, USDT, TRX, USDC, XRP.
15-minute quote window before exchange rate expires. No recurring billing, no
cross-sells. SegPay converts to merchant base currency automatically — no
merchant wallet needed.

**Geographic reach**: merchants in US/UK/Europe; consumers worldwide except
OFAC-restricted countries.

**For Miximodel**: since the product is subscription-based, **credit card is the
primary channel**. PayPal is nice-to-have. Crypto is currently unusable for the
Pro plan (recurring), but **could be a future unlock for one-time purchases**
(credits, lifetime passes, boosts).

## Payment Options (Advanced Features)

SegPay exposes three optional behaviors at the package level:

### Instant Conversion

- Converts a trial subscription to full membership immediately, before the trial
  period ends.
- Useful for "upgrade now" upsells during a trial.
- Requires a valid token (One-Click credential) from the initial purchase.
- Fails with `ERR301-ERR310` if token / config is wrong — see
  `references/error-codes.md`.

### One-Click Payments

- Returning customer feature: card-on-file using a SegPay token.
- Streamlines checkout — user does not re-enter card data.
- **Only available for credit card payments** (not PayPal / crypto).
- Token is stored by SegPay, not Miximodel. Token lifetime / expiration is not
  publicly documented — verify with SegPay.

### Stand-In Processing

- Automatic fallback when the acquiring bank is unreachable (network outage,
  bank downtime).
- Temporarily approves the transaction; SegPay retries the real bank up to 3
  times at 2-hour intervals.
- **Package-level setting only** — cannot be enabled per price point.
- Postback marker: `standin=1` (engaged), `0` (not engaged), `-1` (unsupported).
- **Miximodel handling**: treat stand-in transactions as **pending**. Do NOT
  promote the subscription to `active` until a non-stand-in confirmation
  arrives. If the real bank later declines, SegPay sends a void and cancellation
  postback.

## Recommended Package Configuration for Miximodel Pro

- **Price points**: monthly + yearly (two distinct SegPay packages or two price
  points within one package).
- **Currencies**: enable Dynamic Multi-Currency with Geo IP detection (see
  `references/i18n.md`).
- **Instant Conversion**: disable initially (no trial).
- **One-Click**: enable for credit card only — improves rebill reliability.
- **Stand-In**: enable — reduces false declines during bank outages. Operational
  cost is low since it's a subscription platform.
- **Test Mode**: default on creation; toggle to Live only after sandbox
  validation.

## Cross-Sells

The `xsellnum` postback field (`0` = main, `1` = first cross-sell, `2` = second)
suggests SegPay supports upsell flows on the hosted checkout. Not currently
planned for Miximodel. Document as a future capability if needed (referral
upsells, booster packs, etc.).
