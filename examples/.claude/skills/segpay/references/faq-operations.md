# SegPay — Operations FAQ

> **Load this when:** answering operational questions about disputes,
> chargebacks, fraud, settlement, or consumer support.

## Chargeback Management Programs

SegPay offers two complementary programs to protect merchants from chargebacks:

### CDA — Consumer Dispute Avoidance (Dispute Alerts)

- **Purpose**: intercept disputes **before** they become chargebacks.
- **Mechanism**: SegPay notifies the merchant when a consumer disputes a
  transaction. Merchant has a short window (usually **24 hours**) to refund or
  reject the alert.
- **Benefit**: avoided disputes do not count toward chargeback ratios — critical
  for staying below Visa/MC thresholds.
- **Cost**: per-alert fee; no enrollment fee. Negotiated via the SegPay account
  manager. Usually much lower than a chargeback fee.
- **Enrollment**: may become **mandatory** for accounts exceeding chargeback
  thresholds.
- **Coverage**: reduces disputes by **up to 80%** per SegPay.
- **Access**: Merchant Portal → **My Consumers → Dispute Alerts Report**.
- **Dispute categories**: true fraud, friendly fraud, quality issues, merchant
  errors.

### RDR — Rapid Dispute Resolution

- **Purpose**: Visa's automated dispute resolution. Visa issues the refund
  automatically if the dispute matches predefined criteria, and **the chargeback
  does not count toward the merchant ratio**.
- **Networks**: **Visa only**. Not available for Mastercard, Amex, or Discover.
- **Cards**: credit + debit. Prepaid Visa not guaranteed.
- **Eligibility**: PSP merchant accounts only. Payment Facilitator accounts do
  **not** qualify.
- **Enrollment**: via SegPay Account Manager. Uses BIN and CAID codes (vs CDA
  which uses DBA Descriptors).
- **Cost**: per-reversal fee applies **only** to Visa transactions.
- **Postback marker**: `trantype=RDRreversal`. Treat as a refund event for
  metrics, not a chargeback.
- **Reports**: Merchant Portal → **Dispute Alerts RDR**, also in Detail Ledger,
  Transaction Summary, Transaction Detail, Internal Income Report, SRS Revenue
  Summary By Source.
- **Consumer experience**: statements show both the original purchase and the
  refund. Segpay Consumer Portal lists "RDR Reversals".
- **Confirmation**: SegPay sends confirmation emails on RDR reversals.

### CDA + RDR together

These are complementary, not redundant:

- **CDA** catches disputes **early** (proactive, cross-network).
- **RDR** automates Visa resolutions **automatically** (reactive, Visa-only).

Enabling both is the recommended setup for high-risk merchants.

## TC40 (Visa) / SAFE (Mastercard) — Fraud Reports

- **What**: Fraud reports filed by issuing banks when cardholders report a
  transaction as fraudulent.
- **Relationship to chargebacks**: NOT the same. A fraud report may or may not
  result in a chargeback.
- **Event code**: `Z` in Gateway Admin and Express Stats.
- **Recommended response for digital-goods merchants (Miximodel)**:
  - Cancel the subscription
  - Block the consumer record (add to negative database)
  - Reverse the transaction if appropriate
- **Why you care**: high TC40 volume enrolls merchants in Visa / Mastercard
  excessive fraud programs — operationally expensive.

## Stand-In Processing

See `references/payment-options.md` for full details.

**Quick recap**:

- Temporary approval when the acquiring bank is unreachable.
- Retries up to 3 times at 2-hour intervals.
- Package-level setting only.
- Postback marker: `standin=1` / `0` / `-1`.
- Miximodel: treat as **pending**, wait for confirmation.

## Refund vs Void vs Cancel

SegPay distinguishes three reversal types:

- **Cancel** — stops future rebills, keeps historical transactions intact. The
  user typically retains access until the end of the current paid period.
- **Expire** — ends the subscription immediately, without refunding the last
  charge.
- **Refund only** — returns funds for a specific transaction without cancelling
  the subscription. Rare in SaaS.

**How to process** (via Merchant Portal):

1. **My Consumers → Manage Consumers**
2. Search by email / name
3. (Optional) filter by date range
4. Click **View Record** on the target purchase
5. Choose **Cancel Purchase** (full cancellation + refund) OR check **Reverse**
   in the Initial Transaction table for selective refunds
6. Select **Refund Type**: Cancel / Expire / Refund only
7. Click **Perform Reverse**
8. Status becomes "pending"; table updates once processed
9. If pending > 24h, contact `techsupport@segpay.com`

**Programmatic refunds/cancellations**: via SRS SOAP Admin service (see
`references/srs.md`). No REST API for refunds at time of writing.

## Consumer Self-Service Portal

- **URL**: https://cs.segpay.com/
- **Consumer capabilities**: view transaction history, cancel memberships,
  update card data.
- **Miximodel option**: link users to this portal as a fallback for
  cancellations if the in-app flow fails. Primary path should be programmatic
  via SRS.

## Settlement & Geography

- **Settlement cadence**: typically **3 days in arrears**; **no settlements on
  Sundays or Mondays**.
- **Merchant locations accepted**: United States, United Kingdom, Europe.
- **Consumer locations**: worldwide except countries restricted by the U.S.
  government (OFAC).
- **24×7 consumer support**: SegPay provides first-line consumer support (call,
  chat, email) on behalf of merchants.

## Merchant Portal — Quick Navigation

| Task                      | Path                                          |
| ------------------------- | --------------------------------------------- |
| Refund / cancel a user    | My Consumers → Manage Consumers → View Record |
| View dispute alerts (CDA) | My Consumers → Dispute Alerts Report          |
| View RDR reversals        | My Consumers → Dispute Alerts RDR             |
| Set up retention offers   | My Websites → CancelKeep Retention Offers     |
| Configure postback URL    | My Websites → Manage Postbacks                |
| Manage packages           | My Websites → Manage Packages                 |
| SRS credentials           | SRS / Admin section                           |
| Revenue reports           | Reporting → SRS Revenue Summary By Source     |

## Support

- **Technical support email**: `techsupport@segpay.com`
- **Merchant Portal**: https://mp.segpay.com/
- **SRS portal**: https://srs.segpay.com/
- **Consumer self-service**: https://cs.segpay.com/
- **Client info & FAQ**: https://segpay.com/csfaq/
