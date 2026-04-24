---
name: Logout leak — spec 046 account pool survives sign-out (task 084)
description: Critical auth vuln discovered 2026-04-18 — logout does not destroy server-side session nor purge the device-bound account-pool cookie from spec 046
type: project
---

Fact: Clicking "Sign out" in the Miximodel UI does NOT destroy the outgoing
user's AdonisJS session server-side, and does NOT remove the user's entry from
the device-bound `AccountPoolService` signed cookie introduced by spec 046 /
task 046 ("Make Add-Account Flow Feel Safe and Session-Aware"). A subsequent
user on the same device can reopen the signed-out account from the switcher
without credentials → full account takeover on any shared device (friend's
laptop, cybercafé, hotel business center). Tracked as backlog task 084
(critical, 5 pts, SpecKit required).

Why: The account-pool cookie from spec 046 is device-bound, not user-bound.
Logout was implemented as a UI-state transition (drop the current account from
the active view) rather than as a true session destruction + pool-entry purge.
The UX of the pool ("see your other accounts on this device") assumed the pool
was safe because only the owner ever sees it — but that assumption breaks the
moment the device is shared. The word "logout" carries an implicit security
contract that the current implementation does not honor.

How to apply:

- Any future work on authentication, sessions, cookies, or the account switcher
  MUST consider that logout is currently a UX illusion — scope accordingly, and
  do not build new features on top of the pooled-accounts cookie until task 084
  is merged.
- When spec 046 is referenced in future designs, flag that the pool cookie has a
  known critical leak and that the fix is in flight.
- When evaluating trust-and-safety priorities, task 084 sits above every other
  trust-safety item (005, 006, 010) because it is an active takeover vector, not
  a missing feature.
- Do not surface the "multi-account switcher" as a marketing feature in public
  content until 084 is shipped — the current behavior contradicts any "we keep
  your account safe" claim.
