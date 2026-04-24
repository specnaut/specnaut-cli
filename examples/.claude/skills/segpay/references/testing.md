# SegPay — Testing & Sandbox

> **Load this when:** setting up dev/sandbox, writing functional tests, or
> troubleshooting why a sandbox transaction is not reaching the postback
> endpoint.

## Test Mode Fundamentals

- **New packages default to Test Mode.** When a package is first created in the
  Merchant Portal, its processing status is `Test
  Mode`.
- Test-mode postbacks carry `TESTTRANS=1`. Filter these in the driver before
  touching production subscription state.
- **Not supported in Test Mode**: rebills, refunds, and voids. To exercise these
  flows, you must either simulate manually or move to Live Mode with a small
  real transaction.
- **Live Mode testing** requires real cards; frequent test transactions in Live
  Mode may impact merchant/acquirer relationships — use sparingly.

## Test Card Numbers

| Scenario | Card number           |
| -------- | --------------------- |
| Approval | `4444 3333 2222 1111` |
| Decline  | `4444 4444 4444 4455` |

Any name, any future expiration date, any zip code, and any valid email format
are accepted in Test Mode.

## Test Flow (Credit Card)

1. Merchant Portal → **My Websites → Manage Packages**.
2. Edit the target package.
3. Pricing tab → select a price point → **Get my button code**.
4. Open the generated payment page.
5. Credit Card tab → enter test card + placeholder details → check age/terms →
   **Complete This Secure Purchase**.
6. Note the **Purchase ID** on the confirmation page.
7. Verify: **My Consumers → Manage Consumers** → search by Purchase ID or email
   → **View Postbacks** to confirm delivery.

## Test Flow (Crypto)

1. Same navigation as above, Crypto tab.
2. Enter email → check certification → **Proceed with Crypto Payment**.
3. Choose a fake wallet + cryptocurrency → **Continue** → **Open in Wallet** →
   add transaction details → confirm.
4. Verify postback delivery.

**Note**: crypto does **not** support recurring billing. Only one-time
transactions work.

## Test Flow (PayPal)

1. Same navigation, PayPal tab → **Checkout using PayPal**.
2. Accept confirmation popup.
3. Enter email in the approval popup.
4. Receive Purchase ID from confirmation page.

## Exposing the Local Dev Server to SegPay

SegPay sandbox must be able to reach the Miximodel postback endpoint over the
public internet. Local `localhost:3333` will not work.

Use the project's tunnel skill:

```
/expose-tunnel
```

This builds the app for production and exposes it via Cloudflare Tunnel. Copy
the public URL, then configure the postback URL in the SegPay merchant portal:

```
Merchant Portal → My Websites → Manage Postbacks → Add / Edit
URL: <tunnel-url>/api/webhooks/payment
Description: Miximodel dev tunnel
Expected Response: GOOD
Error Response: BAD
Retry: enabled
```

Drop `https://` — SegPay adds it automatically.

## Writing Functional Tests

### Fixture strategy

- Capture **real sandbox postback bodies** once (from the `View
  Postbacks`
  screen or by logging the raw body in a dev session) and store them as fixture
  files under `tests/fixtures/segpay/postbacks/*.txt`.
- Never synthesize postback bodies from imagination — field order, space
  handling, and URL-encoding quirks are hard to guess.

### Test matrix

For each canonical event, write at least one functional test:

| Fixture                               | Assertion                                   |
| ------------------------------------- | ------------------------------------------- |
| `initial_sale_approved.txt`           | Subscription created, status `active`       |
| `initial_sale_declined.txt`           | No subscription created, audit log          |
| `rebill_success.txt`                  | `nextbilldate` updated, no duplicate        |
| `rebill_declined.txt`                 | Status → `past_due`                         |
| `cancellation.txt`                    | Status → `cancelled`, access until end date |
| `expire.txt`                          | Status → `expired`, access revoked          |
| `refund.txt`                          | Subscription updated, audit log             |
| `chargeback_reversal.txt`             | Audit log, separate from user cancel        |
| `rdr_reversal.txt`                    | Audit log, separate from chargeback         |
| `testtrans_in_production.txt`         | Rejected (401), no state change             |
| `tampered_basic_auth.txt`             | Rejected (401), no state change             |
| `duplicate_tranid.txt` (posted twice) | Second post is a no-op, same final state    |

### Live Mode smoke test (pre-release only)

Before go-live, run a real $1 purchase in Live Mode, verify end-to-end, then
immediately refund it through the Merchant Portal. Document the transaction IDs
in the release notes.

## Debugging a Missing Postback

1. **Verify postback configuration** in the Merchant Portal. Is the URL correct?
   Is retry enabled?
2. **Check the `View Postbacks` screen** for the transaction — SegPay logs
   delivery attempts and merchant responses.
3. **Check Cloud Run logs** for the postback endpoint. Did the request arrive at
   all? Was Basic Auth rejected?
4. **Check the tunnel** — is it still alive? Cloudflare tunnels can disconnect
   after long idles.
5. **Manually replay** by copying the raw body from the Merchant Portal and
   `curl`-ing it to the endpoint with the correct headers.

## Support

- **Technical support email**: `techsupport@segpay.com`
- **Merchant Portal**: `https://mp.segpay.com/`
