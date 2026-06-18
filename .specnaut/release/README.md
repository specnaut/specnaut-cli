# `.specnaut/release/` — Release contract

Two scripts compose the Specnaut CLI release pipeline alongside the bundled tag + notes scripts. See
the design spec at
`specnaut/specnaut-monorepo:docs/superpowers/specs/2026-05-26-release-flow-design.md`.

- `preflight.sh` — runs before any release mutation: branch, cleanliness, CI, smoke audit, bundle,
  test. Exits non-zero on any gate failure.
- `postflight.sh <tag>` — runs after the tag has been pushed: watches `release.yml`, verifies the
  GitHub Release has its assets, verifies the Homebrew tap formula bumped, refreshes the local
  binary.

These files are convention-pathed (the release skill expects them here). To adjust a check, edit the
relevant script — never inline new checks into the skill, or you defeat the whole point of the
contract.

Symmetric scripts live at the same path in `specnaut/specnaut-cloud`. Both repos implement the same
contract; their preflight/postflight bodies differ because their deploy targets differ (binaries +
Homebrew vs. Convex + Cloudflare).

---

## Prerequisites — repo secrets

Two secrets on `specnaut/specnaut-cli`:

### HOMEBREW_TAP_TOKEN

- **`HOMEBREW_TAP_TOKEN`** — fine-grained GitHub Personal Access Token, scoped to
  `mkrlabs/homebrew-tap` only, with `Contents: Read and write`. Created in GitHub → Settings →
  Developer settings → Personal access tokens → Fine-grained tokens. Add it under
  `specnaut/specnaut-cli` → Settings → Secrets and variables → Actions → New repository secret. Used
  by `release.yml`'s tap-bump step.

  If missing, the bump step exits 0 with a workflow warning
  (`HOMEBREW_TAP_TOKEN not set — skipping ...`). The release itself still ships; only the formula
  bump is skipped, and `brew upgrade specnaut` will silently keep serving the previous version until
  the next release that does have the secret.

---

## Recovery — when `specnaut self-update` is broken

If postflight's `specnaut self-update` step fails — typically because the _currently installed_
binary predates a fix to self-update itself and therefore can't reach past its own bug — fall back
to a manual replace:

```bash
case "$(uname -m)" in
  arm64)  asset=specnaut-macos-arm64 ;;
  x86_64) asset=specnaut-macos-x64 ;;
esac
curl -fsSL -o /tmp/specnaut-v<NEXT> \
  "https://github.com/specnaut/specnaut-cli/releases/download/v<NEXT>/$asset"
curl -fsSL -o /tmp/specnaut-v<NEXT>.sha256 \
  "https://github.com/specnaut/specnaut-cli/releases/download/v<NEXT>/$asset.sha256"
expected=$(awk '{print $1}' /tmp/specnaut-v<NEXT>.sha256)
actual=$(shasum -a 256 /tmp/specnaut-v<NEXT> | awk '{print $1}')
[ "$expected" = "$actual" ] || { echo "checksum mismatch"; exit 1; }
chmod +x /tmp/specnaut-v<NEXT>
mv /tmp/specnaut-v<NEXT> "$(command -v specnaut)"
specnaut --version  # must show v<NEXT>
```

Why this matters: the release workflow publishes to GitHub Releases — it does **not** push to your
machine. The only auto-update channel is `specnaut self-update` invoked locally. Skipping the local
refresh means the local binary silently drifts behind every release and any qa-tester pass runs
against stale code. (v0.7.1 stayed installed through three subsequent releases until the next QA
dispatch surfaced it.)
