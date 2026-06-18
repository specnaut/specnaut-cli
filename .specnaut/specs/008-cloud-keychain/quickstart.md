# Quickstart / Manual Verification: Native OS keychain for Cloud CLI credentials

The fallback + selection logic is covered by `deno task test` (FFI-free, fake backend). The **native
paths are verified manually per-OS** — the steps below are the acceptance evidence for each
platform.

## macOS (live-verified)

1. `specflow cloud login` → expect the success line to name **keychain**.
2. Inspect: `security find-generic-password -s specflow-cloud` shows an item for the API URL account
   (the value is NOT printed without `-w`; we never store via `-w`).
3. Confirm no token file: `~/.specnaut/credentials.json` absent (or contains no entry for this URL).
4. Run any authenticated command (e.g. `specflow gate list`) → succeeds, token loaded from keychain.
5. `specflow cloud logout` → keychain item gone (`security find-generic-password -s specflow-cloud`
   returns "could not be found").

## Linux (manually verified per-OS)

1. With gnome-keyring/KWallet unlocked: `specflow cloud login` → names **keychain**.
2. `secret-tool search service specflow-cloud` lists the attribute set (no secret on argv was used
   to store it).
3. Authenticated command succeeds; `logout` clears via `secret_password_clear_sync`.
4. Headless (no Secret Service): `specflow cloud login` → names **file**, succeeds, no hang.

## Windows (manually verified per-OS)

1. `specflow cloud login` → names **keychain**.
2. `cmdkey /list:specflow-cloud*` shows the generic credential (stored via `CredWriteW`, not
   `cmdkey /pass:`).
3. Authenticated command succeeds; `logout` removes it via `CredDeleteW`.

## Secret-never-on-argv check (all platforms)

While a login runs (or with a short sleep injected), in another shell:

```
ps -Aww -o args | grep -i <token-prefix>      # expect: no match
```

and review the keychain backends: no `Deno.Command` / `Deno.run`, no `security -w` /
`secret-tool store` / `cmdkey /pass:`.

## Headless / no-keyring fallback (all platforms)

1. Run in an environment with no reachable keyring (CI, `--allow-ffi` withheld, locked keyring):
   `specflow cloud login` → names **file**, writes `~/.specnaut/credentials.json` `0600`, succeeds
   with no prompt/hang.
2. Authenticated command loads from the file store and succeeds.

## Env escape hatch (regression)

`SPECFLOW_CLOUD_TOKEN=… specflow gate list` → uses the env token, no keychain access attempted;
identical to the prior release.
