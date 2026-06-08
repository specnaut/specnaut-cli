# Research: Native OS keychain for Cloud CLI credentials

## R1 — macOS native API: legacy generic-password vs `SecItem*`

- **Decision**: Use the **legacy generic-password** API from `Security.framework`:
  `SecKeychainAddGenericPassword`, `SecKeychainFindGenericPassword`, `SecKeychainItemDelete`,
  `SecKeychainItemFreeContent` (and add-after-delete for update).
- **Rationale**: These take plain C buffers (`UInt32` length + `void*` pointer) for service,
  account, and password. The secret is a pointer to an in-process byte buffer — never an argv
  (FR-002). The FFI surface is ~5 symbols with primitive signatures.
- **Alternatives considered**: The modern `SecItemAdd`/`SecItemCopyMatching`
  (`kSecClassGenericPassword`) API is the non-deprecated path but requires constructing
  CoreFoundation dictionaries (`CFStringCreateWithCString`, `CFDataCreate`, `CFDictionaryCreate`,
  retain/release discipline) — dozens of extra symbols across `CoreFoundation.framework`, far more
  FFI surface and lifetime bugs, for no security gain here. The legacy API is deprecated-but-stable
  (used by libkeychain, Go's keyring libs, etc.); acceptable given the file fallback backs every
  platform.

## R2 — Linux native API: libsecret

- **Decision**: `libsecret-1.so.0` via `secret_password_store_sync`, `secret_password_lookup_sync`,
  `secret_password_clear_sync` with a fixed `SecretSchema` (two string attributes: `service`,
  `account`).
- **Rationale**: libsecret is the freedesktop standard fronting gnome-keyring / KWallet via the
  Secret Service D-Bus API. The `*_sync` calls take the password as a C-string **function argument**
  (in-process), not a spawned process — satisfies FR-002. `secret-tool` (the CLI) is explicitly
  rejected: its `store` form would put the value on argv.
- **Reachability**: on a headless box with no Secret Service daemon, `*_store/lookup_sync` returns
  `FALSE` and sets a `GError`; the backend treats that as **unavailable** → file fallback (FR-003).
- **Alternatives considered**: raw D-Bus to `org.freedesktop.secrets` (heavier, re-implements
  libsecret); `libsecret` is present on essentially every desktop Linux with a keyring.

## R3 — Windows native API: Credential Manager

- **Decision**: `advapi32.dll` — `CredWriteW`, `CredReadW`, `CredDeleteW`, `CredFree` with a
  `CREDENTIAL` struct (`CRED_TYPE_GENERIC`), UTF-16 target name, secret in `CredentialBlob`.
- **Rationale**: The native user-scope credential vault. Secret travels in the in-memory struct, no
  argv. `cmdkey` (CLI) is rejected — `/pass:` exposes the value on argv.
- **Reachability**: `CredReadW`/`CredWriteW` failure (`GetLastError`) → unavailable → file fallback.

## R4 — Avoiding secret-on-argv (the core constraint)

- **Decision**: Reach every keychain through **`Deno.dlopen` in-process FFI calls** only; pass the
  secret as a pointer/length or C-string **argument** to a library function. Never spawn a process
  that receives the secret (no `security -w`, `secret-tool store …`, `cmdkey /pass:`).
- **Verification**: a `ps`/argv inspection during login shows no secret; a code-path review confirms
  no `Deno.Command`/`Deno.run` in the keychain backends.

## R5 — `--allow-ffi` permission & graceful degradation

- **Decision**: Add `--allow-ffi` to the `deno compile` flags in `scripts/build.ts` (shipped binary
  only). Wrap backend construction (`Deno.dlopen`) in try/catch: a `Deno.errors.PermissionDenied`
  (binary built without the flag, or a sandbox denying FFI) or a missing-library error is treated as
  **keyring unavailable** → `FileCredentialStore`.
- **Rationale**: The feature must never regress a working login because FFI is unavailable. FFI
  permission is a runtime fact, so selection is per-invocation (FR-004).
- **Test impact**: CI/`deno task test` stays FFI-free — selection and `KeychainCredentialStore` are
  tested against an injected fake `KeychainBackend`; the native files are excluded from coverage and
  manually verified per-OS (per the issue's AC).

## R6 — Per-invocation selection & no stale cross-read

- **Decision**: `resolveCredentialStore()` runs at each `defaultCredentialStore()` call: probe the
  platform keychain (cheap sentinel lookup); reachable → `KeychainCredentialStore`, else
  `FileCredentialStore`. A keychain **miss** (no entry) returns `null` from `load` — it does NOT
  fall through to the file store, so a credential written on a desktop and synced to a headless box
  reports "not logged in" rather than serving a stale file token (FR-004, edge case 1).
- **Rationale**: Mixing stores per-read would make "which token am I using" non-deterministic across
  environments; selection is one decision per process.

## R7 — Item naming / multi-deployment

- **Decision**: keychain items use `service = "specflow-cloud"`, `account = <normalised API URL>`
  (same key normalisation as the file store: strip trailing slash). One item per deployment, no
  collision — matches the file store's `{ [apiUrl]: creds }` map (FR: multi-deployment).
- **Secret payload**: the JSON of `CloudCredentials` (`accessToken`, `refreshToken`,
  `accessExpiresAt`) — identical shape to the file store, so backends are interchangeable on
  re-login.
