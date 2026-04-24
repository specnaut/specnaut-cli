---
name: release
description: Publish a new Specflow version — bump semver, commit, tag, and push. Triggers the GitHub Actions release workflow which compiles 5 binaries and uploads them to GitHub Releases.
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

5. **Commit the bump**:

   ```bash
   git add deno.json src/domain/version.ts src/templates_bundle.ts
   git commit -m "chore: release v<NEXT>"
   ```

6. **Tag the commit**:

   ```bash
   git tag -a "v<NEXT>" -m "Release v<NEXT>"
   ```

7. **Push the commit AND the tag**:

   ```bash
   git push origin main
   git push origin "v<NEXT>"
   ```

8. **Watch the release workflow** — tell Kevin the tag push triggered
   `.github/workflows/release.yml`. Give the URL:

   ```
   https://github.com/kevinraimbaud/specflow/actions/workflows/release.yml
   ```

9. **After the workflow succeeds**, verify the release exists:

   ```
   https://github.com/kevinraimbaud/specflow/releases/tag/v<NEXT>
   ```

   Report: binary names, sizes, and checksum SHA256 of each.

## Do not

- Push a release tag if `git status` is dirty.
- Push a release tag without running the test suite locally.
- Release from a branch other than `main`.
- Skip the `deno task bundle` step — stale bundles produce broken binaries.
- Use `git tag` without `-a` (annotated tags only, so GitHub shows the message).

## Rollback

If a release goes wrong:

1. Delete the remote tag: `git push origin :refs/tags/v<BAD>`
2. Delete the local tag: `git tag -d v<BAD>`
3. Delete the GitHub Release via the web UI (tag deletion does not auto-delete
   the release).
4. Fix the issue, bump again (patch), and re-release.
