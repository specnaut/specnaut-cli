# Homebrew formula (packaging)

This directory ships the Homebrew formula source of truth for Specnaut.

## For maintainers — publish a new release to the tap

1. Ensure the `vX.Y.Z` tag has been pushed and the GitHub Actions `release` workflow has uploaded the five binaries + SHA256 files.
2. Compute the SHA256 values locally:

   ```bash
   for f in specnaut-macos-arm64 specnaut-macos-x64 specnaut-linux-arm64 specnaut-linux-x64; do
     curl -fsSL "https://github.com/specnaut/specnaut-cli/releases/download/vX.Y.Z/${f}.sha256"
   done
   ```

3. Copy `specnaut.rb` to the `specnaut/homebrew-tap` repo (`Formula/specnaut.rb`), updating:
   - `version "X.Y.Z"`
   - each `sha256 "..."` placeholder with the real SHA
4. Commit & push the tap repo.
5. Verify locally:

   ```bash
   brew tap specnaut/tap
   brew install specnaut
   specnaut --version
   ```

Auto-push to the tap (via release.yml) is planned for v0.2+.
