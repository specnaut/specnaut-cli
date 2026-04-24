# CCBill — FAQ & Operations Reference

> Load this file for general CCBill operational questions, glossary terms,
> cross-processor cascade, and common troubleshooting.

## Frequently Asked Questions

### What is CCBill's role as Merchant of Record?

As MoR, CCBill is the **legal seller** of record for transactions. This means:

- CCBill handles VAT/tax collection and remittance globally
- CCBill's name appears on the cardholder's statement (with Miximodel
  descriptor)
- CCBill handles dispute/chargeback responses
- Miximodel receives net payouts after fees and taxes

### How does settlement work?

CCBill pays merchants on a regular schedule (typically weekly or bi-weekly) for
transactions processed. Settlement is net of fees, chargebacks, and refunds.

### Can we use both CCBill and SegPay?

Yes. The `PaymentContract` Strategy Pattern supports multiple drivers. Miximodel
can:

- Use CCBill as the default processor
- Keep SegPay as a fallback (one-line IoC change)
- Potentially cascade between the two (see below)

### What is cascading?

Cascading routes a transaction to a backup processor if the primary declines it.
CCBill supports cascading with SegPay:
https://ccbill.com/doc/cascade-setup-for-segpay-users

This is a **future optimization** — not in scope for task 029.

### How do refunds work?

With CCBill as MoR, refunds are processed through CCBill:

1. Miximodel requests refund via RESTful API or DataLink
2. CCBill processes the refund
3. CCBill sends `Refund` webhook
4. Driver normalizes to `subscription.cancelled` with refund flag

### How do chargebacks work?

1. Cardholder disputes with their bank
2. CCBill receives chargeback notification
3. CCBill sends `Chargeback` webhook
4. CCBill manages the dispute response (as MoR)
5. Miximodel cancels the subscription

### What currencies does CCBill support?

CCBill supports major international currencies including EUR, USD, GBP, AUD,
CAD, JPY. The full list with ISO 4217 codes is at:
https://ccbill.com/doc/general-references-and-resources

### What payment methods are accepted?

- Visa, Mastercard, Discover, JCB
- ACH/Direct Debit (US)
- SEPA (EU)
- Various regional methods Full list:
  https://ccbill.com/doc/accepted-payment-methods

## Glossary of Key Terms

| Term            | Definition                                        |
| --------------- | ------------------------------------------------- |
| Account Number  | Main CCBill merchant account identifier           |
| Sub-Account     | Subdivision for different product lines / pricing |
| FlexForms       | CCBill's hosted payment page system               |
| Dynamic Pricing | Server-computed prices via formDigest             |
| Background Post | Legacy name for webhooks                          |
| DataLink        | Legacy admin API (being replaced by REST)         |
| MoR             | Merchant of Record — CCBill is the legal seller   |
| LAS             | Legacy Affiliate System                           |
| formDigest      | MD5 hash for dynamic pricing verification         |
| Salt            | Shared secret for formDigest computation          |
| Cascade         | Routing failed transactions to a backup processor |

## Promotions & Discounts

CCBill supports:

- Promotional pricing (time-limited discounts)
- Cross-sale and up-sale flows
- Discount systems via admin portal Details:
  https://ccbill.com/doc/promotion-and-discount-systems

## 2FA for Admin Access

CCBill Admin Portal supports two-factor authentication:
https://ccbill.com/kb/what-is-two-factor-authentication

Always enable 2FA for the merchant admin account.

## Relevant URLs

- FAQ: https://ccbill.com/doc/frequently-asked-questions
- Glossary: https://ccbill.com/doc/glossary-of-payment-processing-terms
- General References: https://ccbill.com/doc/general-references-and-resources
- Cascade Setup: https://ccbill.com/doc/cascade-setup-for-segpay-users
- Accepted Payments: https://ccbill.com/doc/accepted-payment-methods
- Promotions: https://ccbill.com/doc/promotion-and-discount-systems
- 2FA: https://ccbill.com/kb/what-is-two-factor-authentication
