# Contracts

No new contract. This feature consumes:

1. **`docs/api/gates.md`** (#356) — the `plan_approval` / `merge_approval` gate types (payload +
   `{approved, note?}` answer).
2. **The `specflow gate` CLI surface** (#358) — `gate status` /
   `gate raise --type plan_approval|
   merge_approval` / exit-code contract. The chain templates
   shell out to it; no code changes here.

Per § I the chain raises only project-authored summaries (public) and reads only the public approval
answer — no Cloud-internal identifier crosses.
