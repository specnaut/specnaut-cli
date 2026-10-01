# `.specnaut/release/` — Release contract

Two scripts compose the Specnaut CLI release pipeline alongside the bundled tag + notes scripts. See
the design spec at
`specnaut/specnaut-monorepo:docs/superpowers/specs/2026-05-26-release-flow-design.md`.

- `preflight.sh` — runs before any release mutation: branch, cleanliness, the `ci` AND `smoke`
  workflows green on HEAD, smoke audit, bundle, test. Exits non-zero on any gate failure.
- `postflight.sh <tag>` — runs after the tag has been pushed: watches `release.yml`, verifies the
  GitHub Release has its assets, verifies the Homebrew tap formula bumped, refreshes the local
  binary, verifies the artefacts against the attestation, then runs the published binary end to end
  through `smoke-published.sh`.
- `smoke-published.sh <tag> [binary]` — `init`, scaffold check and `check --project` with the
  installed binary in a throwaway directory. The only check that executes what users download.

These files are convention-pathed (the release skill expects them here). To adjust a check, edit the
relevant script — never inline new checks into the skill, or you defeat the whole point of the
contract.

Symmetric scripts live at the same path in `specnaut/specnaut-cloud`. Both repos implement the same
contract; their preflight/postflight bodies differ because their deploy targets differ (binaries +
Homebrew vs. Convex + Cloudflare).

---

## `HIGHLIGHTS.md` — the lead paragraph

`.specnaut/release/HIGHLIGHTS.md` is the one part of the release notes a human writes. When it has
content, `gen-changelog.ts --highlights` renders it as a `### Highlights` block above every
generated section, including breaking changes.

**Its correct state between releases is empty.** Rewrite it before tagging; `git checkout` it back
to empty as part of the release commit, or leave it empty when a release needs no lead. An empty
file renders nothing, so there is no ceremony for an ordinary patch.

Say what a commit subject cannot: which renames, which defaults changed, what breaks for someone who
does nothing. It is not a second changelog — the sections below it already list every commit.

`scripts/check-release-commit.ts` refuses to tag when this file has content last written at or
before the previous tag. Nothing downstream regenerates these words, so nothing downstream would
notice them being a release out of date — and stale prose reads as authored and current, which is
worse than a section that is visibly missing.

## Prerequisites — repo secrets

**None.** This repository holds no Actions secrets, and must not.

It is public. A secret here is a credential in a public repository, and the three that used to live
here all pointed outward — write access to the Homebrew tap, to the marketplace catalog, and to a
plugin fork. A repository publishing a release does not need write access to everything that
packages or lists it.

The direction is inverted. `specnaut/homebrew-tap` and `specnaut/specnaut-marketplace` each run
their own `sync from specnaut-cli` workflow: they read this repository's Releases API — which needs
no authentication, because this repository is public — and commit to themselves with their own
run-scoped `GITHUB_TOKEN`. Neither side holds a credential for the other.

`HOMEBREW_TAP_TOKEN`, `MARKETPLACE_SYNC_TOKEN` and `CODEX_SYNC_TOKEN` were all deleted on
2026-08-22. Do not re-provision them; nothing reads them, and adding one back would restore the
shape this removed.

**What this costs, and how it is paid.** Each target syncs on an hourly cron, so a release reaches
them within that window rather than within seconds. `postflight.sh` dispatches both immediately
after a release using the operator's own `gh` credentials, then reads the published formula and
catalog back — so a normal release still publishes at once, and "dispatched" is never mistaken for
"published".

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
