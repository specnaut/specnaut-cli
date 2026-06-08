# Implementation Plan: Native OS keychain for Cloud CLI credentials

**Feature**: `008-cloud-keychain` | **Spec**: [spec.md](./spec.md) | **Issue**: mkrlabs/specflow#360

## Summary

Add an OS-native keychain backend behind the existing `CredentialStore` interface
(`src/infrastructure/credential_store.ts`, #353), reached via **Deno FFI** against each platform's
native library — never a secret-bearing CLI. A per-invocation selector returns the keychain when a
keyring is reachable and the existing `0600` `FileCredentialStore` otherwise (headless/CI), so login
and every authenticated command behave exactly as today where no keyring exists. The native backends
sit behind an injectable `KeychainBackend` port so the **selection + fallback logic is fully unit
tested without FFI**; the macOS native path is live-verified, Linux/Windows documented as
manually-verified-per-OS. `SPECFLOW_CLOUD_TOKEN` and the wire contract are untouched.

## Technical Context

- **Language/runtime**: Deno + TypeScript (existing). First FFI use in the repo.
- **Permissions**: `Deno.dlopen` requires `--allow-ffi`. Add it to the `deno compile` flags in
  `scripts/build.ts` (the distributed binary) only. `dev`/`test` tasks stay FFI-free — tests inject
  a fake `KeychainBackend`; the file fallback needs no FFI. A binary built/run **without**
  `--allow-ffi` (or a sandbox that denies it) MUST degrade to the file store, not crash.
- **New code**:
  - `src/infrastructure/keychain/keychain_backend.ts` — the `KeychainBackend` port
    (`get`/`set`/`remove` by `service`+`account`, returning hit/miss/unavailable) + a
    `KeychainCredentialStore implements CredentialStore` that (de)serialises `CloudCredentials` JSON
    as the secret and is keyed by Cloud API URL.
  - `src/infrastructure/keychain/macos.ts` — `Security.framework` via FFI
    (`SecKeychainAddGenericPassword` / `SecKeychainFindGenericPassword` /
    `SecKeychainItemModifyContent`-or-delete+add / `SecKeychainItemFreeContent` /
    `SecKeychainItemDelete`). Legacy generic-password API: plain C buffers, no CoreFoundation —
    smallest FFI surface, password passed as an in-memory byte pointer (FR-002).
  - `src/infrastructure/keychain/linux.ts` — `libsecret-1` via FFI (`secret_password_store_sync` /
    `secret_password_lookup_sync` / `secret_password_clear_sync` with a fixed schema). Password is a
    C-string argument to the in-process call, not an argv.
  - `src/infrastructure/keychain/windows.ts` — `advapi32` Credential Manager via FFI (`CredWriteW` /
    `CredReadW` / `CredDeleteW`, `CredFree`). Secret lives in the in-memory `CREDENTIAL` blob.
  - `src/infrastructure/keychain/select.ts` — `resolveCredentialStore()`: pick the platform backend,
    `dlopen` + probe (sentinel lookup) inside try/catch; any throw/unavailable →
    `FileCredentialStore`.
- **Changed code**:
  - `src/infrastructure/credential_store.ts` — add a readonly `kind: "keychain" | "file"` to the
    `CredentialStore` interface (file store returns `"file"`); rewire `defaultCredentialStore()` to
    delegate to `resolveCredentialStore()`. The 4 existing call sites are unchanged (still call
    `defaultCredentialStore()`); only `cloud login` reads `.kind` to report which store secured the
    token (FR-007).
  - `src/cli/handlers/cloud_handler.ts` — login success line states keychain vs file.
  - `scripts/build.ts` — add `--allow-ffi` to the compile permission set.
  - `docs/` — a short "where Cloud credentials are stored" note incl. the re-login upgrade path.
- **Untouched**: wire protocol, token issuance/TTL, `SPECFLOW_CLOUD_TOKEN` handling, the file
  store's on-disk format (so a file→keychain user and a keychain→file fallback interoperate by
  re-login, never silent cross-read — FR-004).

## Constitution Check

- **Monorepo § I/§ II (OSS/proprietary boundary)**: purely _local at-rest storage_ on the CLI side.
  No Cloud-internal identifier touched; nothing new crosses the boundary; the wire contract is
  unchanged. **PASS**.
- **Security posture**: FFI is a powerful permission (loads native libs). Confined to three audited
  files that dlopen exactly one well-known system library each by fixed name; no dynamic/derived lib
  path, no `--allow-run`, no secret on any argv. The added `--allow-ffi` applies only to the shipped
  binary. **Justified, no violation.**
- **Hexagonal layering**: native code lives in `infrastructure/`, behind the existing
  `CredentialStore` port + the new `KeychainBackend` port; domain/auth code is unaffected. **PASS**.

## Project Structure

```
src/infrastructure/credential_store.ts                 # EXTEND — kind field; defaultCredentialStore→resolve
src/infrastructure/keychain/keychain_backend.ts        # NEW — port + KeychainCredentialStore
src/infrastructure/keychain/select.ts                  # NEW — per-invocation backend selection + probe
src/infrastructure/keychain/macos.ts                   # NEW — Security.framework FFI (live-verified)
src/infrastructure/keychain/linux.ts                   # NEW — libsecret FFI (manually verified per-OS)
src/infrastructure/keychain/windows.ts                 # NEW — advapi32 FFI (manually verified per-OS)
src/cli/handlers/cloud_handler.ts                      # EXTEND — report store kind on login
scripts/build.ts                                       # EXTEND — add --allow-ffi to compile flags
docs/cloud-credentials.md                              # NEW — storage + re-login upgrade path
tests/unit/keychain_store_test.ts                      # NEW — KeychainCredentialStore over a fake backend
tests/unit/keychain_select_test.ts                     # NEW — selection: reachable→keychain, error→file
tests/unit/credential_store_test.ts                    # EXTEND — kind field; fallback selection
```

## Phase 0 — Research

See [research.md](./research.md): which native API per platform (and why the legacy macOS
generic-password API over the CoreFoundation `SecItem*` surface), how each avoids passing the secret
as an argv, keyring-reachability probing, and the `--allow-ffi`/permission-denied fallback.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — `KeychainBackend` port, `KeychainCredentialStore`, the
  selection decision table, and the keychain item-naming scheme (service/account).
- [contracts/README.md](./contracts/README.md) — internal port contracts only; no external/wire
  contract changes (the `/api/v1` surface is untouched).
- [quickstart.md](./quickstart.md) — per-OS manual verification steps (store→inspect→load→delete) +
  the `ps` no-leak check + the headless fallback check.
