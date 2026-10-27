# Guided macOS session — keychain observations (T040)

Two observations need a human at the keyboard (plan §12 Q2): a Keychain **Always Allow** grant
across a binary replacement (FR-018, feeds
[#428 — Sign + notarize the macOS release binary to stop repeated Keychain prompts](https://github.com/specnaut/specnaut-cli/issues/428)),
and an exec capture with `sudo eslogger` (FR-017). An agent never clicks a security dialog and never
runs `sudo`; everything below is prepared so the maintainer performs only those two acts. Results go
into `spike-report.md`.

Every command runs from `apps/specnaut-cli/`. Nothing here touches the real credential: both probes
refuse `specnaut-cloud` and `specflow-cloud`, and write only under the service the Go driver prints
(`specnaut-keychain-probe`). The canary is random per run, read from a `0600` file, and never
printed.

## Already observed by the agent (no dialog, no sudo)

Each binary created, read and deleted its own item — the case that does not prompt:

| probe                                       | reachable | set/get/remove                            | leftovers |
| :------------------------------------------ | :-------- | :---------------------------------------- | :-------- |
| Go (`go-keyring` v0.2.8, cgo off)           | true      | write ok · read match (32/32) · remove ok | none      |
| TypeScript (shipped backend port, compiled) | true      | write ok · read match (32/32) · remove ok | none      |

Not run, because each raises a dialog: the cross-direction reads (one binary reading an item the
other wrote).

## 0. Prepare

```bash
CGO_ENABLED=0 go build -trimpath -o dist/keychain-probe ./cmd/keychain-probe
deno compile --allow-ffi --allow-env --allow-read -o dist/keychain-probe-ts scripts/keychain-probe.ts
SVC=$(dist/keychain-probe service)          # specnaut-keychain-probe
S=$(mktemp -d) && chmod 700 "$S"
( umask 077; openssl rand -hex 24 > "$S/canary" )
```

## 1. Cross-direction reads (expect dialogs; answer **Allow**, not Always Allow)

```bash
scripts/keychain-probe-matrix.sh dist/keychain-probe dist/keychain-probe-ts
```

Record each `##` step's verdict. Expected from the source (verify, do not assume): the TS reader
sees a Go-written item as `mismatch` (go-keyring stores `go-keyring-base64:<…>`,
`keyring_darwin.go:74`), the Go reader sees a TS-written item as `match` (it returns unprefixed
values as they are).

## 2. Always Allow, then replace the binary (FR-018)

**Go-written item.** go-keyring reads and writes through `/usr/bin/security`, so the app the
Keychain asks about is `security`, not the probe:

```bash
dist/keychain-probe write --account grant-go < "$S/canary"
dist/keychain-probe read  --account grant-go < "$S/canary"    # dialog? if so: Always Allow
CGO_ENABLED=0 go build -trimpath -ldflags=-s -o dist/keychain-probe ./cmd/keychain-probe   # new bytes
dist/keychain-probe read  --account grant-go < "$S/canary"    # record: prompt again, or not
```

**TypeScript-written item, read by Go and by a rebuilt TypeScript probe:**

```bash
dist/keychain-probe-ts write --service "$SVC" --account grant-ts < "$S/canary"
dist/keychain-probe read --account grant-ts < "$S/canary"      # dialog for `security`: Always Allow
CGO_ENABLED=0 go build -trimpath -o dist/keychain-probe ./cmd/keychain-probe       # replace Go
dist/keychain-probe read --account grant-ts < "$S/canary"      # record: prompt again, or not
deno compile --allow-ffi --allow-env --allow-read -o dist/keychain-probe-ts scripts/keychain-probe.ts
dist/keychain-probe-ts read --service "$SVC" --account grant-ts < "$S/canary"   # record (#428's case)
```

Clean up both items (each by the binary that owns it, to avoid a further dialog):

```bash
dist/keychain-probe remove --account grant-go
dist/keychain-probe-ts remove --service "$SVC" --account grant-ts
dist/keychain-probe remove --account go-wrote; dist/keychain-probe-ts remove --service "$SVC" --account ts-wrote
security find-generic-password -s "$SVC" >/dev/null 2>&1; echo "exit $? (44 = nothing left)"
```

## 3. Exec capture: the secret is on no argv (FR-017)

Capture every exec for the probe's lifetime, then require the **positive marker** (an exec of
`/usr/bin/security` by the probe — no observation is a failure, not a pass) and the **canary in no
captured argv**:

```bash
sudo eslogger exec > "$S/exec.ndjson" &          # the one sudo step
sleep 2
dist/keychain-probe roundtrip --account eslogger < "$S/canary"
sleep 2; sudo kill %1                             # stop the capture

# Positive marker: at least one exec of /usr/bin/security from the probe.
jq -c 'select(.event.exec.target.executable.path == "/usr/bin/security")
       | {by: .process.executable.path, args: .event.exec.args}' "$S/exec.ndjson" | grep keychain-probe
# Canary check: must print 0.
grep -c -F -f "$S/canary" "$S/exec.ndjson"
```

Expected, from `keyring_darwin.go@v0.2.8`: `security -i` (line 76) receives
`add-generic-password … -w <secret>` on stdin (line 86); `find-generic-password -s … -a … -w`
(line 44) and `delete-generic-password` carry no secret. A marker with zero lines voids the check.

## 4. Finish

```bash
rm -rf "$S"
```

Copy the verdicts of steps 1–3 into `spike-report.md` (dated), including negative ones.
