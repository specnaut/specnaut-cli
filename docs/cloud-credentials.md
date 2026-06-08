# Where Specflow Cloud credentials are stored

`specflow cloud login` (#353) obtains an access token + refresh token for your Specflow Cloud
deployment. Those are secrets; this page explains where they are kept at rest and how to control it.

## Two backends, selected automatically

On every command, Specflow picks a credential store for the current machine and session:

| Backend                     | When it is used                                                                   | Where the secret lives                                                                  |
| --------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **OS keychain** (preferred) | A keyring is reachable (desktop, unlocked session)                                | macOS Keychain · Linux libsecret (gnome-keyring / KWallet) · Windows Credential Manager |
| **`0600` file** (fallback)  | No reachable keyring — headless servers, CI, SSH sessions, or a build without FFI | `~/.specflow/credentials.json`, mode `0600` inside a `0700` directory                   |

`specflow cloud login` prints which store secured your token:

```
✓ authenticated with Specflow Cloud
  credentials stored in the OS keychain
```

or, on a headless box:

```
✓ authenticated with Specflow Cloud
  credentials stored in ~/.specflow/credentials.json (0600 — no OS keychain available)
```

The selection is made **per invocation** — a token written under one environment is never silently
served from a different store under another.

## How the keychain is reached (and what it never does)

The keychain is accessed through the platform's **native API via Deno FFI** (`SecKeychain*` on
macOS, `secret_password_*` on Linux, `Cred*W` on Windows). The secret is only ever passed as an
in-process function argument — it is **never** handed to a spawned process. In particular Specflow
does not shell out to `security -w`, `secret-tool store`, or `cmdkey /pass:`, all of which would
expose the token on the process command line (readable by `ps`).

The keychain path needs the `--allow-ffi` permission, which the released binary ships with. If FFI
is unavailable (a custom build without the flag, or a sandbox that denies it), Specflow falls back
to the `0600` file — login still succeeds.

## Headless / CI

Set `SPECFLOW_CLOUD_TOKEN` to a Cloud API token. It bypasses both stores entirely; no keychain
access is attempted. This is the supported path for CI and unattended VMs (it is unchanged from
#353).

## Upgrading from a file-only version

Earlier versions stored credentials only in `~/.specflow/credentials.json`. There is **no automatic
migration** into the keychain — simply run `specflow cloud login` once more on a machine with a
keyring and the token is re-stored in the OS keychain. The old file entry can be removed with
`specflow cloud logout` beforehand if you want a clean slate.

## Multiple deployments

Both stores key credentials by the deployment's API base URL, so one machine can hold tokens for
several Specflow Cloud deployments without collision.
