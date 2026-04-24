# Homebrew formula (packaging)

This directory ships the Homebrew formula source of truth for Specflow.

## For maintainers — publish a new release to the tap

1. Ensure the `vX.Y.Z` tag has been pushed and the GitHub Actions `release` workflow has uploaded the five binaries + SHA256 files.
2. Compute the SHA256 values locally:

   ```bash
   for f in specflow-macos-arm64 specflow-macos-x64 specflow-linux-arm64 specflow-linux-x64; do
     curl -fsSL "https://github.com/mkrlabs/specflow/releases/download/vX.Y.Z/${f}.sha256"
   done
   ```

3. Copy `specflow.rb` to `kevinraimbaud/homebrew-tap` repo (`Formula/specflow.rb`), updating:
   - `version "X.Y.Z"`
   - each `sha256 "..."` placeholder with the real SHA
4. Commit & push the tap repo.
5. Verify locally:

   ```bash
   brew tap kevinraimbaud/tap
   brew install specflow
   specflow --version
   ```

Auto-push to the tap (via release.yml) is planned for v0.2+.
