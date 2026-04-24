---
name: CCBill Integration Complete
description: Spec 178 / Task 029 — CCBill as default payment processor with affiliate program, DONE as of 2026-04-09
type: project
---

CCBill integration (spec 178, task 029) is COMPLETE and merged on main (commit 4c56d66).

**What was delivered:**
- CCBillDriver implementing full PaymentContract (FlexForms checkout, DataLink cancel, webhook verification)
- Native affiliate program integration (affiliate ID round-trips from URL to checkout to webhook to subscription)
- CCBill is now the default IoC binding; SegPay remains as first-class fallback
- Infrastructure secrets declared for CCBill in Pulumi
- ccbill-expert agent and .claude/skills/ccbill/ skill created
- Unit tests covering URL construction, webhook verification, idempotency

**How to apply:**
- Both SegPay and CCBill merchant applications are running in parallel (task 027 still active for business onboarding)
- Task 028 (legal/compliance pages) is DONE — merged via spec 179 (commit 5d39e13f)
- Switching back to SegPay remains a one-line IoC change in providers/payment_provider.ts
- Pricing: EUR 19/month (30 days), EUR 99/year (365 days), currency code 978
- Next commerce priority: submit merchant applications (tracked in 027)
- Task 027 downgraded from critical to high — remaining scope is business/admin, not code
