# `.specflow/release/` — Release contract

Two scripts compose the Specflow CLI release pipeline alongside the bundled tag + notes scripts. See
the design spec at
`mkrlabs/specflow-monorepo:docs/superpowers/specs/2026-05-26-release-flow-design.md`.

- `preflight.sh` — runs before any release mutation: branch, cleanliness, CI, smoke audit, bundle,
  test. Exits non-zero on any gate failure.
- `postflight.sh <tag>` — runs after the tag has been pushed: watches `release.yml`, verifies the
  GitHub Release has its assets, verifies the Homebrew tap formula bumped, refreshes the local
  binary.

These files are convention-pathed (the release skill expects them here). To adjust a check, edit the
relevant script — never inline new checks into the skill, or you defeat the whole point of the
contract.

Symmetric scripts live at the same path in `mkrlabs/specflow-cloud`. Both repos implement the same
contract; their preflight/postflight bodies differ because their deploy targets differ (binaries +
Homebrew vs. Convex + Cloudflare).

---

## Prerequisites — repo secrets

Two secrets on `mkrlabs/specflow`:

### HOMEBREW_TAP_TOKEN

- **`HOMEBREW_TAP_TOKEN`** — fine-grained GitHub Personal Access Token, scoped to
  `mkrlabs/homebrew-tap` only, with `Contents: Read and write`. Created in GitHub → Settings →
  Developer settings → Personal access tokens → Fine-grained tokens. Add it under `mkrlabs/specflow`
  → Settings → Secrets and variables → Actions → New repository secret. Used by `release.yml`'s
  tap-bump step.

  If missing, the bump step exits 0 with a workflow warning
  (`HOMEBREW_TAP_TOKEN not set — skipping ...`). The release itself still ships; only the formula
  bump is skipped, and `brew upgrade specflow` will silently keep serving the previous version until
  the next release that does have the secret.

### WIKI_SSH_KEY

- **`WIKI_SSH_KEY`** — SSH **Deploy Key** (not a PAT). Fine-grained PATs on GitHub do not expose a
  "Wiki" permission — it's a real GitHub limitation. A deploy key with write access to
  `mkrlabs/specflow` can push to the wiki repo too (GitHub treats the wiki as part of the same repo
  for deploy-key purposes). Used by `wiki.yml` to mirror `docs/llms.md` → `<wiki>/Home.md` on every
  push to `main`.

  Setup (one-time):
  ```bash
  # 1. Generate an ed25519 keypair (no passphrase — it's a CI key).
  ssh-keygen -t ed25519 -f /tmp/wiki-deploy -N "" \
    -C "specflow-wiki-sync"

  # 2. Public key → repo Deploy Keys (with write access).
  gh repo deploy-key add /tmp/wiki-deploy.pub \
    --repo mkrlabs/specflow \
    --title "wiki-sync (CI)" \
    --allow-write

  # 3. Private key → repo secret WIKI_SSH_KEY.
  gh secret set WIKI_SSH_KEY \
    --repo mkrlabs/specflow \
    < /tmp/wiki-deploy

  # 4. Wipe the local keypair files — they're now in GitHub.
  shred -u /tmp/wiki-deploy /tmp/wiki-deploy.pub
  ```

  First-time wiki init: visit `https://github.com/mkrlabs/specflow/wiki` ONCE after enabling the
  wiki feature so GitHub auto-initializes the default `Home.md` on the wiki's `master` branch (yes,
  `master` — wiki repos default to `master` regardless of the source repo's default branch). Without
  that one-time visit, the first sync fails with `Repository not found` because the wiki repo
  doesn't physically exist until GitHub auto-inits it.

  If `WIKI_SSH_KEY` is missing, the sync step exits 0 with a workflow warning
  (`WIKI_SSH_KEY not set — skipping ...`). The source-of-truth `docs/llms.md` and the
  `specflow.makerlabs.dev` Pages deploy are unaffected; only the wiki mirror is paused.

---

## Recovery — when `specflow self-update` is broken

If postflight's `specflow self-update` step fails — typically because the _currently installed_
binary predates a fix to self-update itself and therefore can't reach past its own bug — fall back
to a manual replace:

```bash
case "$(uname -m)" in
  arm64)  asset=specflow-macos-arm64 ;;
  x86_64) asset=specflow-macos-x64 ;;
esac
curl -fsSL -o /tmp/specflow-v<NEXT> \
  "https://github.com/mkrlabs/specflow/releases/download/v<NEXT>/$asset"
curl -fsSL -o /tmp/specflow-v<NEXT>.sha256 \
  "https://github.com/mkrlabs/specflow/releases/download/v<NEXT>/$asset.sha256"
expected=$(awk '{print $1}' /tmp/specflow-v<NEXT>.sha256)
actual=$(shasum -a 256 /tmp/specflow-v<NEXT> | awk '{print $1}')
[ "$expected" = "$actual" ] || { echo "checksum mismatch"; exit 1; }
chmod +x /tmp/specflow-v<NEXT>
mv /tmp/specflow-v<NEXT> "$(command -v specflow)"
specflow --version  # must show v<NEXT>
```

Why this matters: the release workflow publishes to GitHub Releases — it does **not** push to your
machine. The only auto-update channel is `specflow self-update` invoked locally. Skipping the local
refresh means the local binary silently drifts behind every release and any qa-tester pass runs
against stale code. (v0.7.1 stayed installed through three subsequent releases until the next QA
dispatch surfaced it.)
