# Feature Specification: Native OS keychain for Cloud CLI credentials

**Feature Branch**: `008-cloud-keychain`\
**Created**: 2026-06-08\
**Status**: Draft\
**Input**: "Store Specflow Cloud CLI credentials in the native OS keychain via Deno FFI (macOS
Keychain Services, Linux libsecret, Windows Credential Manager) instead of the `0600` home file,
with graceful fallback to that file store when no keyring is available (headless / CI). The secret
must NEVER be passed as a process argument (no `security -w`, which leaks it to `ps`); use the
native OS API directly. The `SPECFLOW_CLOUD_TOKEN` env escape hatch is unchanged. Follow-up to
#353." (issue #360; security hardening of `specflow cloud login`)

## Overview

`specflow cloud login` (#353) stores the Cloud access + refresh tokens in a `0600` JSON file under
`~/.specflow` — the same default `aws`, `gcloud`, and headless `gh` use. This feature adds an
**OS-native keychain** as the preferred at-rest store, protecting the secret from other same-user
processes better than a file can, and **falls back to the existing `0600` file** wherever no keyring
is reachable (CI, headless servers, SSH sessions without a unlocked keyring) — mirroring `gh`'s
behaviour. The keychain is reached through Deno FFI against each platform's native API, never the
`security` CLI (whose `-w <secret>` form would expose the token in process argv). The
`SPECFLOW_CLOUD_TOKEN` env escape hatch and the public wire contract are untouched.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Login stores the token in the OS keychain (Priority: P1)

A user runs `specflow cloud login` on a desktop with an unlocked keyring. The access + refresh
tokens are written to the OS keychain (macOS Keychain / libsecret / Windows Credential Manager), not
to a plaintext-on-disk file. Subsequent `/api/v1` calls load the token transparently from the
keychain; `specflow cloud logout` deletes it.

**Why this priority**: This is the security payoff — the at-rest secret moves out of a flat file
into the OS-guarded store on the machines where one is available.

**Acceptance Scenarios**:

1. **Given** a reachable keyring, **When** `specflow cloud login` completes, **Then** the
   credentials are stored via the native keychain API and no token is written to
   `~/.specflow/credentials.json`.
2. **Given** credentials stored in the keychain, **When** any authenticated command runs, **Then**
   the token is loaded from the keychain and the request succeeds.
3. **Given** credentials stored in the keychain, **When** `specflow cloud logout` runs, **Then** the
   keychain entry is deleted and a subsequent authenticated command reports "not logged in".

---

### User Story 2 - Graceful fallback where no keyring exists (Priority: P1)

A user runs `specflow cloud login` on a headless CI runner or a server with no keyring daemon. The
keychain is unavailable, so credentials fall back to the existing `0600` file store transparently —
login succeeds, and every later command finds the token. The user is informed (once) which store was
used.

**Why this priority**: Specflow runs unattended on VMs (the headless remote-control mode); login
must never fail or hang because a desktop keyring is absent.

**Acceptance Scenarios**:

1. **Given** no reachable keyring, **When** `specflow cloud login` runs, **Then** it stores
   credentials in the `0600` file store and reports success without prompting or hanging.
2. **Given** credentials in the file-fallback store, **When** an authenticated command runs,
   **Then** the token loads from the file and the request succeeds.
3. **Given** a keyring that errors mid-operation (locked, daemon crash), **When** a store/load is
   attempted, **Then** the failure degrades to the file store rather than aborting the command.

---

### User Story 3 - The secret is never exposed to other processes (Priority: P1)

While `specflow cloud login` writes the token, no other same-user process can read the secret from
the process table. The token is passed to the OS only through the native in-memory API call, never
as a command-line argument.

**Why this priority**: The whole point of leaving the file store is a stronger at-rest posture;
leaking the secret to `ps` during the write would defeat it.

**Acceptance Scenarios**:

1. **Given** a login in progress, **When** the process table is inspected (`ps`/argv), **Then** the
   token does not appear in any process's arguments or environment of a spawned child.
2. **Given** the keychain code path, **When** it is reviewed, **Then** it invokes no external CLI
   that takes the secret as an argument (`security -w`, `secret-tool store` with the value on argv,
   `cmdkey /pass:`).

---

### User Story 4 - The env escape hatch is unchanged (Priority: P2)

A CI job sets `SPECFLOW_CLOUD_TOKEN`. Commands use that token directly, bypassing both the keychain
and the file store exactly as before — no keychain read is attempted.

**Acceptance Scenarios**:

1. **Given** `SPECFLOW_CLOUD_TOKEN` is set, **When** an authenticated command runs, **Then** the env
   token is used and neither store is consulted (behaviour identical to the prior release).
2. **Given** `SPECFLOW_CLOUD_TOKEN` is set, **When** `specflow cloud login`/`logout` run, **Then**
   their interaction with the env hatch is unchanged from #353.

### Edge Cases

- **Keyring present at login, absent at read** (e.g. token stored on desktop, repo synced to a
  headless box): the read finds nothing in the keychain and reports "not logged in" rather than
  silently reading a stale file — store selection is resolved per-invocation, not cached across
  environments.
- **Partial write** (keychain accepts access token but errors on refresh token): the operation is
  atomic per deployment key — a failed write leaves the prior entry intact and surfaces the error,
  never a half-updated credential.
- **Migration**: a user upgrading with credentials already in `~/.specflow/credentials.json` is not
  auto-migrated; the next `specflow cloud login` re-stores into the keychain. A one-time re-login is
  acceptable and documented.
- **Multiple deployments**: keychain entries are keyed by Cloud API base URL exactly like the file
  store, so one machine holds tokens for several deployments without collision.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The CLI MUST store, load, and delete Cloud credentials through the **native OS
  keychain API** when a keyring is reachable — macOS Keychain Services, Linux libsecret, Windows
  Credential Manager — keyed by Cloud API base URL.
- **FR-002**: The secret MUST NEVER be passed as a process argument or environment variable to any
  spawned process; the keychain MUST be reached through the native in-memory API (FFI), never a CLI
  whose argument carries the value.
- **FR-003**: When no keyring is reachable (unavailable, locked, errors), the CLI MUST fall back to
  the existing `0600`-file store transparently, so login and all authenticated commands succeed
  headless/CI exactly as before.
- **FR-004**: Store selection MUST be resolved per invocation so a credential written under one
  environment is not silently served from a different store under another; a keychain miss MUST NOT
  fall through to a stale file entry.
- **FR-005**: The `SPECFLOW_CLOUD_TOKEN` env escape hatch MUST behave identically to #353 — when set
  it bypasses both stores and no keychain access is attempted.
- **FR-006**: Each store/delete MUST be atomic per deployment key — a failed keychain operation
  leaves the prior entry intact and surfaces the error rather than corrupting or half-writing it.
- **FR-007**: The CLI MUST inform the user (at login) which store secured the credentials (keychain
  vs file fallback) so the at-rest posture is never silently weaker than expected.
- **FR-008**: The feature MUST NOT change the wire protocol, the Cloud-side token issuance, or leak
  any Cloud-internal identifier across the boundary (§ I) — it is purely local at-rest storage.
- **FR-009**: Existing file-stored credentials MUST NOT be auto-migrated; a one-time re-login
  re-stores into the keychain and is documented as the upgrade path.

### Key Entities

- **Credential store** — the abstraction (load / save / delete by API URL) with two concrete
  backends: the native keychain and the `0600` file (the existing `FileCredentialStore`).
- **Keychain backend** — the per-platform native implementation (Keychain Services / libsecret /
  Credential Manager) reached via FFI.
- **Store selector** — the per-invocation decision that picks the keychain when reachable and the
  file store otherwise.

## Domain Model _(mandatory)_

**Bounded context**: The CLI's **at-rest Cloud credential storage** — how the access + refresh
tokens are secured on the local machine and which backend serves a given invocation. It owns backend
selection and the keychain/file implementations; it does NOT own token issuance or refresh (Cloud,
via the wire contract), the env escape hatch's meaning (#353), or the `/api/v1` request path — it
only supplies the token those consume.

**Ubiquitous language**:

- **Keychain backend** — native OS secret store reached via FFI (Keychain Services / libsecret /
  Credential Manager).
- **File fallback** — the existing `0600` JSON store under `~/.specflow`.
- **Reachable keyring** — a keychain that can be opened and read/written this invocation.
- **Store selection** — per-invocation choice of keychain vs file fallback.

**Entities**: none new with identity (credentials are keyed by Cloud API URL, as today).

**Value objects**: `CloudCredentials` (`accessToken`, `refreshToken`, `accessExpiresAt`) — unchanged
from #353, stored by value under the API-URL key.

**Invariants**:

- The secret is never exposed to another process (no argv/env hand-off).
- A keychain miss never serves a stale file entry (per-invocation selection).
- The env escape hatch (`SPECFLOW_CLOUD_TOKEN`) short-circuits both stores, unchanged.
- Only local storage changes — nothing new crosses the boundary (§ I).
- A failed write leaves the prior credential intact (atomic per key).

**Out of scope**:

- Changing the wire protocol or Cloud-side token issuance / lifetime (a Cloud concern; coordinated
  only via the public HTTP contract).
- Shortening the access-token TTL (server-controlled; tracked separately if pursued).
- Auto-migrating existing file-stored credentials (one-time re-login is the upgrade path).
- Encrypting the file-fallback store at rest (it remains `0600`, matching `gh`/`aws`/`gcloud`).

## Success Criteria _(mandatory)_

- **SC-001**: On a desktop with an unlocked keyring, `specflow cloud login` stores the credentials
  in the OS keychain and writes no token to `~/.specflow/credentials.json`; an authenticated command
  then succeeds loading from the keychain — verified on macOS.
- **SC-002**: On a headless host with no keyring, `specflow cloud login` succeeds via the file
  fallback and every authenticated command works — with zero prompts or hangs.
- **SC-003**: During a login, the token never appears in the process table (`ps`/argv) of any
  process — verified by inspection and by the absence of any secret-bearing CLI invocation in the
  code path.
- **SC-004**: With `SPECFLOW_CLOUD_TOKEN` set, behaviour is byte-for-byte identical to the prior
  release (no keychain access attempted).
- **SC-005**: The login output states which store was used, and the upgrade (re-login) path is
  documented.

## Assumptions

- #353 shipped `FileCredentialStore`, `CredentialStore`, and `defaultCredentialStore()` in
  `src/infrastructure/credential_store.ts`; this feature adds keychain backends behind the same
  interface and rewires `defaultCredentialStore()` to select per platform/reachability.
- Deno FFI (`Deno.dlopen`) is available in the distributed runtime and the binary is granted the FFI
  permission; the native libraries (`Security.framework` on macOS, `libsecret-1` on Linux,
  `advapi32` on Windows) are present on machines that have a keyring.
- Only the **macOS** native path is live-verifiable in this environment; the Linux and Windows
  native paths are implemented to the same interface and documented as **manually verified per-OS**,
  with the file fallback as the always-present safety net behind every platform.
- The access-token TTL stays as issued by Cloud; any shortening is a Cloud-side change negotiated
  through the wire contract, not part of this feature.
- Credentials remain keyed by Cloud API base URL, so multi-deployment behaviour matches #353.

## Dependencies

- **#353** — `specflow cloud login` + `FileCredentialStore` (the interface extended and the fallback
  reused). Done.
- Deno FFI + the per-platform system keychain libraries at runtime.
