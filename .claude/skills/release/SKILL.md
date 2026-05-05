---
name: release
description: Publish a new Specflow version — bump semver, commit, tag, and push. Triggers the GitHub Actions release workflow which compiles 5 binaries, generates a structured changelog, and uploads everything to GitHub Releases.
---

# Specflow Release Skill

Use this skill when Kevin asks to "release", "publish a new version", "bump
and release", "tag a release", or similar. This skill runs ONLY in the
Specflow repo.

## Preflight

1. Verify you are on `main` and the working tree is clean:
   ```bash
   git rev-parse --abbrev-ref HEAD  # must be "main"
   git status --porcelain           # must be empty
   ```
2. Verify CI is green on the latest commit (check GitHub Actions for the most
   recent workflow run on `main` — ask the user to confirm if unsure).
3. Ask the user which bump they want:
   - `patch` → bug fixes, no feature changes
   - `minor` → new features, no breaking changes
   - `major` → breaking changes
   - `prerelease:<tag>` → e.g. `prerelease:alpha` or `prerelease:beta`

## Steps

1. **Bump the version** — run:

   ```bash
   deno run --allow-read --allow-write scripts/bump-version.ts <kind>
   ```

   This updates `deno.json` and `src/domain/version.ts` in lockstep.

2. **Review the diff** and confirm with Kevin:

   ```bash
   git diff deno.json src/domain/version.ts
   ```

3. **Regenerate the bundle** in case templates changed since the last release:

   ```bash
   deno task bundle
   ```

4. **Run the full test suite locally** — must be green:

   ```bash
   deno task test
   ```

5. **Preview the changelog** (optional — useful to spot bad commit messages
   before they end up in the GitHub Release body):

   ```bash
   deno run --allow-read --allow-write --allow-run scripts/gen-changelog.ts \
     --out /tmp/release-notes-preview.md
   cat /tmp/release-notes-preview.md
   ```

   The script reads commits in `<prev_tag>..HEAD`, classifies each by its
   conventional-commit prefix (`feat:` / `fix:` / `chore:` / `refactor:` /
   etc.), strips the prefix and capitalises, and writes a Markdown summary
   with three sections: **Features**, **Bug fixes**, **Internal / chores**
   (collapsed). The release-bump commit itself is omitted automatically.

   If a commit subject reads poorly in the changelog, fix the commit
   message *before* tagging — once the tag is pushed the changelog is set.

6. **Commit the bump**:

   ```bash
   git add deno.json src/domain/version.ts src/templates_bundle.ts
   git commit -m "chore: release v<NEXT>"
   ```

7. **Tag the commit**:

   ```bash
   git tag -a "v<NEXT>" -m "Release v<NEXT>"
   ```

8. **Push the commit AND the tag**:

   ```bash
   git push origin main
   git push origin "v<NEXT>"
   ```

9. **Watch the release workflow** — tell Kevin the tag push triggered
   `.github/workflows/release.yml`. The workflow bundles templates,
   cross-compiles 5 binaries, computes their SHA-256 checksums, and
   regenerates the changelog (same script as step 5) into
   `dist/release-notes.md` which is then attached to the GitHub Release
   via `body_path`. Give the URL:

   ```
   https://github.com/mkrlabs/specflow/actions/workflows/release.yml
   ```

10. **After the workflow succeeds**, verify the release exists and the body
    looks structured (not the old auto-generated PR list):

    ```
    https://github.com/mkrlabs/specflow/releases/tag/v<NEXT>
    ```

    Report: binary names, sizes, checksum SHA256 of each, and confirm the
    release body shows the **Features / Bug fixes / Internal** sections.

    **Also confirm the homebrew-tap formula bumped automatically.** The
    release workflow's last step pushes `Formula/specflow.rb` on
    `mkrlabs/homebrew-tap` to the new version + checksums. Verify with:

    ```bash
    gh api repos/mkrlabs/homebrew-tap/commits/main --jq '.commit.message'
    ```

    Expected: `chore: bump specflow to <NEXT>` as the latest commit. If the
    step was skipped, the workflow log will say `HOMEBREW_TAP_TOKEN not
    set — skipping ...`. In that case the secret needs to be (re)provisioned
    — see "Prerequisites" at the bottom of this skill.

11. **Refresh the local binary** — keep `~/.local/bin/specflow` (or
    wherever `command -v specflow` resolves) in sync with what you just
    shipped, so the next qa-tester dispatch and Kevin's day-to-day usage
    actually run the released code:

    ```bash
    specflow self-update
    specflow --version  # must show v<NEXT>
    ```

    If `self-update` fails — typically because the *currently installed*
    binary predates a fix to self-update itself and therefore can't reach
    past its own bug — fall back to a manual replace:

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

    Why this matters: the release workflow publishes to GitHub Releases —
    it does **not** push to Kevin's machine. The only auto-update channel
    is `specflow self-update` invoked locally. Skipping this step means
    the local binary silently drifts behind every release and any
    qa-tester pass runs against stale code. (This is exactly how v0.7.1
    stayed installed through three subsequent releases until the next QA
    dispatch surfaced it.)

## Do not

- Push a release tag if `git status` is dirty.
- Push a release tag without running the test suite locally.
- Release from a branch other than `main`.
- Skip the `deno task bundle` step — stale bundles produce broken binaries.
- Use `git tag` without `-a` (annotated tags only, so GitHub shows the message).
- Hand-edit `dist/release-notes.md` — it's regenerated by the workflow on
  every release. Fix bad changelog content by amending the source commits
  before tagging.
- Mark the release "done" before step 11 — a green workflow alone does not
  update the local binary, and stale local installs defeat the QA loop.

## Rollback

If a release goes wrong:

1. Delete the remote tag: `git push origin :refs/tags/v<BAD>`
2. Delete the local tag: `git tag -d v<BAD>`
3. Delete the GitHub Release via the web UI (tag deletion does not auto-delete
   the release).
4. Revert the homebrew-tap bump if it landed (`gh api -X DELETE` is not
   exposed for branches; instead push a force-revert commit on
   `mkrlabs/homebrew-tap` main, or land a new bump from the corrected
   patch release).
5. Fix the issue, bump again (patch), and re-release.

## Prerequisites

The release workflow needs one secret on `mkrlabs/specflow` for the
homebrew-tap bump step to work:

- **`HOMEBREW_TAP_TOKEN`** — fine-grained GitHub Personal Access Token,
  scoped to `mkrlabs/homebrew-tap` only, with `Contents: Read and write`.
  Created in GitHub → Settings → Developer settings → Personal access
  tokens → Fine-grained tokens. Add it under
  `mkrlabs/specflow` → Settings → Secrets and variables → Actions →
  New repository secret.

If the secret is missing, the bump step exits 0 with a workflow warning
(`HOMEBREW_TAP_TOKEN not set — skipping ...`). The release itself still
ships; only the formula bump is skipped, and `brew upgrade specflow`
will silently keep serving the previous version until the next release
that does have the secret.
