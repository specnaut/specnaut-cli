---
name: github-release
description: Create a GitHub Release for a tag, verify the Docker image is built and Cloud Build succeeded, then generate release notes automatically. Use when the user asks to "release", "create a release", "github release", "deploy this tag", or "publish release".
---

# GitHub Release — Verify, Release & Deploy

Create a GitHub Release for a tagged commit after verifying that Cloud Build has successfully built and pushed the Docker image to Artifact Registry. This triggers the `deploy.yml` workflow (Pulumi + migrations + Telegram notification).

## When to Use

- After pushing a git tag (via `/git-tag`)
- When the user wants to deploy a specific version to production
- To check the status of Cloud Build and Artifact Registry images

## Procedure

When the user asks to create a release, execute the **release.sh** script:

```bash
# Release the latest tag (default)
bash .claude/skills/github-release/scripts/release.sh

# Release a specific tag
bash .claude/skills/github-release/scripts/release.sh v26.3.29e
```

### What the script does

1. **Fetches tags** and identifies the latest (or specified) tag
2. **Checks Cloud Build status** for the tag — waits if still building
3. **Verifies image exists** in Artifact Registry
4. **Shows a summary** and asks for user confirmation
5. **Generates release notes** from commits since the previous tag
6. **Creates the GitHub Release** via `gh release create`
7. **Reports the deploy workflow URL** so the user can monitor

### Before running

- Ensure `gcloud` is authenticated (`gcloud auth list`)
- Ensure `gh` is authenticated (`gh auth status`)

### After running

- The `deploy.yml` workflow triggers automatically
- Monitor via: `gh run watch` or the GitHub Actions URL printed by the script
- A Telegram notification will be sent on success/failure

## GCP Utility Commands

For ad-hoc infrastructure checks, use the **gcp-status.sh** script:

```bash
# Show full status dashboard (images, builds, Cloud Run service)
bash .claude/skills/github-release/scripts/gcp-status.sh

# List recent Artifact Registry images
bash .claude/skills/github-release/scripts/gcp-status.sh images

# Check Cloud Build history
bash .claude/skills/github-release/scripts/gcp-status.sh builds

# Show current Cloud Run service status
bash .claude/skills/github-release/scripts/gcp-status.sh service
```

## Flow

```
/git-tag              → Creates & pushes tag (triggers Cloud Build)
/github-release       → Verifies build, creates GitHub Release (triggers deploy.yml)
deploy.yml            → pulumi sync (env vars) + gcloud deploy (image) + migrate + Telegram
```

## Edge Cases

- If Cloud Build is still running, the script waits (polls every 30s, max 15 min)
- If Cloud Build failed, the script aborts with the failure reason
- If the image doesn't exist in Artifact Registry, the script aborts
- If a GitHub Release already exists for the tag, the script shows its URL instead
- If no tags exist, the script aborts with an error
