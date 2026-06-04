# Contracts

Two contracts meet here:

1. **`docs/api/gates.md`** (#356) — the public wire format the underlying #357 client speaks. This
   feature does not change it.
2. **The `specflow gate` CLI surface** — the new _internal_ contract between the markdown clarify
   phase and the CLI binary (see [../data-model.md](../data-model.md) for the exact stdout/exit
   table). `gate status` / `gate raise` / `gate cancel`. This is the only thing the phase depends
   on; it is stable for #359 to reuse for plan/merge approval gates.

Per § I the command surfaces only the public answer JSON and CLI-owned exit codes — never a
Cloud-internal identifier or backend error string.
