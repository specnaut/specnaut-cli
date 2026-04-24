---
name: RGPD Delete Account Complete
description: Spec 180 / Task 013 — GDPR-compliant account deletion, DONE as of 2026-04-09
type: project
---

GDPR Delete Account (spec 180, task 013) is COMPLETE and merged on main (commit cc21225b).

**Why:** Legal compliance requirement for EU users. Also unblocks task 030 (Async Data Export with Media Files).

**How to apply:**
- Users can now delete their account from settings with password confirmation
- 30-day soft-delete grace period before permanent anonymization
- GCS media cleanup included
- Task 030 (async ZIP export with media) is now unblocked
- Task 018 (Wire Checkout Buttons) also marked done — absorbed by 026/029 payment integrations
