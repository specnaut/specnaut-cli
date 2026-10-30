# Remote-mode gates — plan and merge approval

Loaded by `phases/auto-chain.md` when `specnaut gate status` exits 0: the project is in remote
mode, and approvals are raised as gates instead of asked in the terminal. **Remote mode keeps its
gate under either mode** — `merge: auto` does not lift it.

## Plan approval checkpoint (remote mode only)

After `plan` completes and **before** chaining into `implement`, check remote mode
(`specnaut gate status`):

- **Exit 0** (remote on) — raise a plan-approval gate and suspend:
  `specnaut gate raise --type plan_approval --title "Approve the plan for <feature>" --payload '{"summary":"<plan summary>","planRef":"<plan.md path>","context":"<short>"}'`.
  exit 0 + `{"approved":true}` → resume into `implement`; exit 0 + `{"approved":false}` → halt and
  report the rejection + any `note`; exit 3/4/1 → halt cleanly with the reason; exit 5 → no gate
  was raised (the Cloud login is missing or lapsed): report `specnaut cloud login` is needed and halt
  before `implement` — nothing approved the plan. **Never proceed to `implement` without an explicit
  approval.**
- **Non-zero** (remote off / not Cloud-linked — the default) — STOP 1 is the local approval and the
  chain continues straight into `implement`.

## Merge approval

After `review`, in remote mode, raise a `merge_approval` gate instead of a terminal prompt:
`specnaut gate raise --type merge_approval --title "Approve merge of <feature>" --payload '{"summary":"<change summary>","prUrl":"<pr/diff ref>","context":"<short>"}'`.
exit 0 + `{"approved":true}` → invoke `merge`; exit 0 + `{"approved":false}` → halt on the branch
and report the rejection + any `note`; exit 3/4 (timeout/cancelled) or 1 → halt cleanly with the
reason; exit 5 → no gate was raised (the Cloud login is missing or lapsed), so nothing approved the
merge: report `specnaut cloud login` is needed, then under `merge: manual` ask the one question in
`phases/auto-chain.md`; under `merge: auto` there is no local prompt: halt on the branch, as on
exit 3/4 — the merge waits for a login and a re-run, or the user's own `merge`.
**Never merge without an explicit approval.**
