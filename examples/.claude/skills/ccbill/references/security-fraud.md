# CCBill — Security & Fraud Prevention Reference

> Load this file when reviewing security aspects of the CCBill integration, PCI
> compliance, or fraud-related questions.

## PCI DSS Compliance

CCBill as a hosted-checkout provider (FlexForms) means Miximodel **never handles
raw card data**. This significantly reduces PCI scope:

- **Miximodel PCI level**: SAQ A (simplest) — the merchant never stores,
  processes, or transmits cardholder data.
- **CCBill handles**: Card data collection, storage, tokenization, and PCI Level
  1 compliance.
- **Miximodel handles**: Securing webhook endpoints, protecting API credentials,
  securing pass-through data.

PCI DSS 4.0 is now in effect (since March 2024). Key requirements that still
apply to SAQ A merchants:

- Multi-factor authentication for admin access
- Secure transmission of all data (HTTPS everywhere)
- Regular security scans if hosting payment-adjacent pages

## Fraud Prevention

CCBill provides built-in fraud prevention:

### AVS (Address Verification System)

Compares billing address with card issuer records. CCBill handles this
automatically. AVS mismatches may result in declined transactions (see error
codes).

- More info: https://ccbill.com/kb/avs-mismatch-rejected

### 3D Secure (3DS)

Adds cardholder authentication (Visa Secure, Mastercard Identity Check). CCBill
handles the 3DS flow within FlexForms.

- Liability shift:
  https://ccbill.com/kb/successful-liability-shift-for-enrolled-card-is-required

### BIN Attack Prevention

CCBill monitors for BIN attacks (rapid card testing). Rate limiting and velocity
checks are applied at the processor level.

- More info: https://ccbill.com/kb/bin-attack

### Address Fraud Detection

CCBill flags suspicious address patterns.

- More info: https://ccbill.com/kb/address-fraud

## Chargeback Management

As Merchant of Record, CCBill handles chargeback disputes on behalf of
merchants. The chargeback flow:

1. Cardholder disputes charge with their bank
2. Bank sends chargeback to CCBill
3. CCBill sends `Chargeback` webhook to Miximodel
4. Miximodel driver normalizes to `subscription.cancelled` with chargeback flag
5. CCBill manages the dispute response

## Webhook Security

### Endpoint Security

- HTTPS only (TLS 1.2+)
- Digest verification on all incoming webhooks
- Constant-time comparison for secrets
- IP allowlisting as secondary defense

### Secrets Management

- `CCBILL_SALT` — dynamic pricing digest salt
- `CCBILL_WEBHOOK_SECRET` — webhook verification secret
- `CCBILL_API_CLIENT_SECRET` — OAuth2 client secret
- All stored in GCP Secret Manager via Pulumi
- Never logged, never in client-side code

## Relevant URLs

- PCI DSS: https://ccbill.com/kb/pci-dss
- AVS Mismatch: https://ccbill.com/kb/avs-mismatch-rejected
- BIN Attack: https://ccbill.com/kb/bin-attack
- Address Fraud: https://ccbill.com/kb/address-fraud
- Soft vs Hard Decline: https://ccbill.com/kb/soft-decline-vs-hard-decline
- Authorization Hold: https://ccbill.com/kb/authorization-hold
- Card on File: https://ccbill.com/kb/card-on-file
- Tokenization: https://ccbill.com/kb/credit-card-tokenization
- Liability Shift:
  https://ccbill.com/kb/successful-liability-shift-for-enrolled-card-is-required
