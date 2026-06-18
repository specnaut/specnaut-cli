# Tasks: Native OS keychain for Cloud CLI credentials

**Feature**: `008-cloud-keychain` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Repo**: `apps/specflow` (`mkrlabs/specflow`, issue #360)

Standing gate after every code task:
`deno task check && deno lint && deno fmt --check && deno task test`.

## Phase A — Ports & file-store extension (no FFI)

- [x] **T001** `src/infrastructure/keychain/keychain_backend.ts` (NEW): define `KeychainResult<T>`
      (hit / miss / unavailable), the `KeychainBackend` port (`get`/`set`/`remove`/`reachable`,
      `platform`), and `KeychainCredentialStore implements CredentialStore` (`kind="keychain"`) —
      wraps a backend, `service="specflow-cloud"`, `account=keyFor(apiUrl)`, (de)serialises
      `CloudCredentials` JSON; `load` miss → `null`. (FR-001, FR-006)
- [x] **T002** `src/infrastructure/credential_store.ts`: add readonly `kind: "keychain" | "file"` to
      the `CredentialStore` interface; `FileCredentialStore` returns `kind="file"`. Export `keyFor`
      for reuse by the keychain store. No behaviour change to the file store. (FR-007)

## Phase B — Native FFI backends (manually verified per-OS; macOS live-verified)

- [x] **T003** `[P]` `src/infrastructure/keychain/macos.ts` (NEW): `MacosKeychainBackend` via
      `Deno.dlopen("/System/Library/Frameworks/Security.framework/Security")` —
      `SecKeychainAddGenericPassword` / `SecKeychainFindGenericPassword` / `SecKeychainItemDelete` /
      `SecKeychainItemFreeContent`; update = delete-then-add. Secret passed as a byte-buffer pointer
      (no argv). Construction/dlopen guarded; lib/symbol failure → backend reports unavailable.
      (FR-002, FR-003)
- [x] **T004** `[P]` `src/infrastructure/keychain/linux.ts` (NEW): `LibsecretBackend` via
      `Deno.dlopen("libsecret-1.so.0")` — `secret_password_store_sync` /
      `secret_password_lookup_sync` / `secret_password_clear_sync` with a fixed two-attribute schema
      (`service`, `account`). Password is a C-string arg (no argv). No daemon / `GError` →
      unavailable. (FR-002, FR-003)
- [x] **T005** `[P]` `src/infrastructure/keychain/windows.ts` (NEW): `WindowsCredentialBackend` via
      `Deno.dlopen("advapi32.dll")` — `CredWriteW` / `CredReadW` / `CredDeleteW` / `CredFree`,
      `CRED_TYPE_GENERIC`, UTF-16 target `specflow-cloud:<account>`, secret in `CredentialBlob`.
      Failure (`GetLastError`) → unavailable. (FR-002, FR-003)

## Phase C — Selection & wiring

- [x] **T006** `src/infrastructure/keychain/select.ts` (NEW): `resolveCredentialStore(opts?)` — pick
      the platform backend via an injectable factory (default keys off `Deno.build.os`), `dlopen` +
      `reachable()` probe inside try/catch; reachable → `KeychainCredentialStore`, any
      `PermissionDenied` / missing-lib / unreachable → `FileCredentialStore`. Pure + injectable for
      tests (no FFI on the default-injected path). (FR-003, FR-004)
- [x] **T007** `src/infrastructure/credential_store.ts`: rewire `defaultCredentialStore()` to
      delegate to `resolveCredentialStore()` (real factory). The 4 existing call sites stay
      source-compatible. (FR-003, FR-004)
- [x] **T008** `src/cli/handlers/cloud_handler.ts`: on `cloud login` success, append one line naming
      the store (`keychain` vs `file`) by reading `store.kind`. `logout`/env-hatch paths unchanged.
      (FR-005, FR-007)
- [x] **T009** `scripts/build.ts`: add `--allow-ffi` to the `deno compile` permission flags (shipped
      binary). Confirm `dev`/`test` tasks stay FFI-free. (FR-003)
- [x] **T010** `[P]` `docs/cloud-credentials.md` (NEW): where Cloud credentials live (keychain vs
      file fallback), the no-secret-on-argv guarantee, the env hatch, and the one-time re-login
      upgrade path (no auto-migration). (FR-009)

## Phase D — Tests (no FFI, no network)

- [x] **T011** `[P]` `tests/unit/keychain_store_test.ts` (NEW): `KeychainCredentialStore` over a
      fake `KeychainBackend` — save→load round-trips `CloudCredentials`; miss → `null`; delete
      removes; multi-deployment keys isolate by API URL; a backend failure on `set` leaves the prior
      item intact (atomic per key). (SC-001, FR-006)
- [x] **T012** `[P]` `tests/unit/keychain_select_test.ts` (NEW): `resolveCredentialStore` with an
      injected factory — reachable backend → `kind=keychain`; `reachable()=false` → `kind=file`;
      factory throws `PermissionDenied` → `kind=file`; factory throws lib-missing → `kind=file`.
      (SC-002, FR-003, FR-004)
- [x] **T013** `tests/unit/credential_store_test.ts`: extend (or add) —
      `FileCredentialStore.kind ===
      "file"`; existing save/load/delete + `0600` behaviour
      unchanged; a keychain miss does not read the file store (selection-level assertion). (SC-002,
      SC-004)

## Phase E — Validation & review

- [x] **T014** Full standing gate green. Manual macOS verification per
      [quickstart.md](./quickstart.md) (login→`security find-generic-password`→authed cmd→logout) +
      the `ps` no-leak check. Record evidence. (SC-001, SC-003, SC-005)
- [x] **T015** Security/boundary review: grep the keychain backends for any
      `Deno.Command`/`Deno.run` and for `security -w` / `secret-tool store` / `cmdkey /pass:` (must
      be none); confirm `--allow-ffi` is the only new permission and is binary-only; confirm no
      Cloud-internal identifier or wire-contract change (§ I/§ II). (SC-003, FR-002, FR-008)

## Dependencies

```
A (T001–T002) → B (T003–T005, [P]) → C (T006–T010) → D (T011–T013) → E (T014–T015)
```

T003/T004/T005 are `[P]` (independent platform files). T010 is `[P]` (docs). T011/T012 are `[P]`.
The native backends (B) are excluded from `deno task test`; the file fallback + selection + store
logic (D) is fully covered with an injected fake backend — no FFI permission needed in CI.
