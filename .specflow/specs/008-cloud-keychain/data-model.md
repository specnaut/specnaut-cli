# Data Model: Native OS keychain for Cloud CLI credentials

No persisted schema changes on disk. This feature adds in-memory ports and a storage-backend
selection; the stored secret payload is the unchanged `CloudCredentials` shape from #353.

## Value objects (unchanged from #353)

- **`CloudCredentials`** — `{ accessToken: string; refreshToken: string; accessExpiresAt: number }`.
  Serialised to JSON as the secret payload in both backends. Keyed by normalised Cloud API URL.

## Ports

### `KeychainBackend` (new)

Native secret-store operations, platform-implemented, injectable for tests.

```
type KeychainResult<T> =
  | { ok: true; value: T }            // hit
  | { ok: true; value: null }         // miss (no such item)
  | { ok: false; unavailable: true }  // keyring not reachable this invocation

interface KeychainBackend {
  readonly platform: "macos" | "linux" | "windows";
  get(service: string, account: string): Promise<KeychainResult<string>>;
  set(service: string, account: string, secret: string): Promise<KeychainResult<void>>;
  remove(service: string, account: string): Promise<KeychainResult<void>>;
  /** Cheap probe used by the selector; sentinel lookup, never throws. */
  reachable(): Promise<boolean>;
}
```

### `CredentialStore` (extended from #353)

```
interface CredentialStore {
  readonly kind: "keychain" | "file";   // NEW — login reports which secured the token (FR-007)
  load(apiUrl: string): Promise<CloudCredentials | null>;
  save(apiUrl: string, creds: CloudCredentials): Promise<void>;
  delete(apiUrl: string): Promise<void>;
}
```

## Entities / implementations

- **`KeychainCredentialStore implements CredentialStore`** (`kind = "keychain"`) — wraps a
  `KeychainBackend`; `service = "specflow-cloud"`, `account = keyFor(apiUrl)`; (de)serialises
  `CloudCredentials` JSON. A backend `unavailable` result from any op surfaces as an error so the
  selector (which already chose this store) is the single fallback point — it is never reached
  because selection happened up front, but a mid-flight `unavailable` degrades to a thrown error
  with a clear message rather than data loss.
- **`FileCredentialStore implements CredentialStore`** (`kind = "file"`) — unchanged behaviour;
  gains the `kind` field.

## Selection decision table (`resolveCredentialStore()`)

| Platform backend `dlopen`                    | `reachable()` probe          | Result store                                |
| -------------------------------------------- | ---------------------------- | ------------------------------------------- |
| succeeds                                     | `true`                       | `KeychainCredentialStore` (`kind=keychain`) |
| succeeds                                     | `false` (no daemon / locked) | `FileCredentialStore` (`kind=file`)         |
| throws `PermissionDenied` (no `--allow-ffi`) | —                            | `FileCredentialStore`                       |
| throws (lib missing / unsupported OS)        | —                            | `FileCredentialStore`                       |

## Invariants

- Selection is resolved once per invocation; a keychain **miss** returns `null` and never reads the
  file store (no stale cross-read).
- `set`/`remove` are atomic per `account`: a failure leaves the prior item intact.
- The secret is only ever a pointer/argument to an in-process native call — never an argv/env to a
  spawned process.
- `kind` truthfully reflects the active backend so the login message cannot overstate the at-rest
  posture.
