# Contracts: Native OS keychain for Cloud CLI credentials

## External / wire contracts

**None changed.** This feature is purely local at-rest storage on the CLI side. The `/api/v1`
surface, the Cloud token issuance, the bearer-token request path, and the gate wire format are all
untouched. No Cloud-internal identifier crosses the boundary (Monorepo Constitution § I/§ II).

## Internal port contracts (this repo only)

### `KeychainBackend` (new port — `src/infrastructure/keychain/keychain_backend.ts`)

- `get/set/remove(service, account[, secret])` operate on a single native generic-password /
  credential item. They MUST return a `KeychainResult` (hit / miss / unavailable) and MUST NOT throw
  for the normal "no keyring" case — `unavailable` is a value, not an exception.
- Implementations MUST pass the secret only as an in-process argument (pointer/length or C-string),
  never to a spawned process. Verified by review + the `ps` no-leak check.
- `reachable()` MUST be side-effect-free (a sentinel lookup) and MUST NOT throw.

### `CredentialStore` (extended port — `src/infrastructure/credential_store.ts`)

- Adds a readonly `kind: "keychain" | "file"`. Existing `load/save/delete` semantics and the API-URL
  keying are unchanged, so the keychain and file backends are interchangeable across a re-login.
- `defaultCredentialStore()` keeps its signature (returns a `CredentialStore`); its 4 existing call
  sites are source-compatible. Only `cloud login` reads `.kind`.

## CLI surface

- No new commands or flags. `specflow cloud login` gains one informational line naming the store
  (`keychain` vs `file`). `logout` deletes from whichever store selection resolves. The
  `SPECFLOW_CLOUD_TOKEN` env hatch is unchanged.
