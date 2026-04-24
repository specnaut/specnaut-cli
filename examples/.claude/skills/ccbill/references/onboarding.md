# CCBill — Merchant Onboarding Reference

> Load this file when Kevin asks about applying to CCBill,
> merchant account setup, or onboarding requirements.

## Application Process

CCBill merchant onboarding follows this flow:

1. **Apply online** at https://www.ccbill.com/merchants or via
   https://ccbill.com/contact
2. **Merchant review** — CCBill reviews the business, website,
   and content
3. **Documentation submission** — Business registration, ID,
   bank details
4. **Website compliance check** — CCBill verifies required
   legal pages are live
5. **Account activation** — Credentials issued, sandbox access
   granted
6. **Integration** — Implement FlexForms, webhooks, go live

## Required Legal Pages (Website Compliance)

CCBill requires these pages to be **live and accessible** before
approving the merchant account:

| Page                        | Required | Notes                          |
| --------------------------- | -------- | ------------------------------ |
| Terms of Service            | Yes      | Must reference recurring billing |
| Privacy Policy (GDPR/RGPD)  | Yes      | Must comply with EU GDPR       |
| Refund/Cancellation Policy  | Yes      | Clear cancellation process     |
| Contact Page                | Yes      | Visible support contact        |
| About Page                  | Yes      | Business description           |
| 2257 Compliance Statement   | If applicable | For adult content            |
| Age Verification            | If applicable | For age-restricted content   |
| Recurring Billing Disclosure| Yes      | Must be visible at checkout    |
| DBA/Descriptor Display      | Yes      | How charge appears on statement|
| Mentions Legales            | Yes (FR) | Required by French law         |

**Note:** These are the same pages required by SegPay (task `028`).
Work done for 028 applies directly to the CCBill application.

## Required Business Documents

For a French SARL (MakerLabs):

- **KBIS** or equivalent (extrait RCS)
- **SIREN/SIRET** certificate
- **Owner ID** (passport or carte d'identite)
- **Bank account details** (IBAN/BIC for EUR settlement)
- **Processing history** (if any — volume projections if new)
- **Website URL** with all legal pages live

## CCBill-Specific Advantages

- **Merchant of Record**: CCBill handles VAT for international
  customers. No per-country VAT registration needed.
- **No rolling reserve** (typically): CCBill's MoR model often
  avoids the rolling reserve required by direct merchant accounts.
- **Native affiliate program**: No additional setup needed.
- **High-risk friendly**: CCBill specializes in high-risk verticals.

## Rates and Fees

CCBill rates for high-risk SaaS/subscription typically:

| Fee Type                | Typical Range          |
| ----------------------- | ---------------------- |
| Discount rate           | 8-12% (includes MoR)  |
| Transaction fee         | Included in rate       |
| Chargeback fee          | $25-50 per CB          |
| Monthly minimum         | Varies                 |
| Setup fee               | Often waived           |
| Rolling reserve         | Usually none (MoR)     |

**Note:** CCBill's rate is higher than SegPay's (5.5-9%) because
it **includes** Merchant of Record services (VAT handling). The
total cost may be comparable when you factor in the VAT compliance
burden that SegPay would require separately.

## Key Contacts

- Merchant applications: https://ccbill.com/contact
- Partners: https://ccbill.com/partners
- Merchant support: merchantsupport@ccbill.com

## Relevant URLs

- Contact: https://ccbill.com/contact
- Partners: https://ccbill.com/partners
- Account Change Forms: https://ccbill.com/doc/account-change-forms
- Merchant ID: https://ccbill.com/kb/merchant-id
