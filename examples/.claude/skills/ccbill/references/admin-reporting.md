# CCBill — Admin Portal & Reporting Reference

> Load this file when working with the CCBill admin portal, transaction reports,
> DataLink, or account management.

## Admin Portal

The CCBill Admin Portal is the web-based dashboard for managing the merchant
account. Key sections:

- **Account Management** — Sub-accounts, user permissions, API credentials
- **FlexForms** — Create and configure payment forms
- **Webhooks** — Configure webhook URLs and events
- **Reports** — Transaction reports, settlement, chargebacks
- **Dynamic Pricing** — Set salt, enable per sub-account
- **Affiliate Program** — Manage the Legacy Affiliate System

Admin URL: https://admin.ccbill.com (production)

## DataLink

DataLink is CCBill's legacy administrative API for programmatic access to
account data. Key operations:

| Operation            | Description                           |
| -------------------- | ------------------------------------- |
| Subscription lookup  | Get status, dates, amounts            |
| Subscription cancel  | Cancel an active subscription         |
| Transaction lookup   | Get details of a specific transaction |
| Chargeback report    | List chargebacks for a period         |
| Consumer info lookup | Get customer details by subscription  |

DataLink is being gradually replaced by the RESTful API but remains available
for operations not yet covered by REST.

## Merchant Transactions Report

Available in the Admin Portal under Reports. Key fields:

- Transaction ID
- Subscription ID
- Date/time
- Amount and currency
- Transaction type (sale, rebill, cancel, refund, chargeback)
- Payment method
- Customer info (anonymized)
- Affiliate attribution (if applicable)

Reports can be exported and filtered by date range, type, and sub-account.

## Account Change Forms

For account-level changes (adding sub-accounts, changing rates, updating bank
details), CCBill requires formal change forms:
https://ccbill.com/doc/account-change-forms

## Key Admin Tasks for Miximodel Setup

1. **Create sub-account** for Miximodel subscriptions
2. **Create FlexForms** payment flow and note the ID
3. **Enable dynamic pricing** on the sub-account and set the salt
4. **Configure webhooks** — URL, events, secret
5. **Generate API credentials** — OAuth2 client ID and secret
6. **Set up Legacy Affiliate System** if using affiliates
7. **Configure return/cancel URLs**

## Relevant URLs

- Admin Portal FAQ: https://ccbill.com/doc/admin-portal-faq
- Merchant Transactions Report:
  https://ccbill.com/doc/merchant-transactions-report
- Account Change Forms: https://ccbill.com/doc/account-change-forms
- Promotion & Discount Systems:
  https://ccbill.com/doc/promotion-and-discount-systems
