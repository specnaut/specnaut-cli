---
name: github-pr
description: Create a GitHub Pull Request from the current feature branch, wait for CI + preview deployment, and report the preview URL with a summary of provisioned GCP resources. Use when the user asks to "create a PR", "open a PR", "pull request", "github pr", or "deploy this branch".
---

# GitHub PR — Create Pull Request with Preview Environment

Create a GitHub Pull Request from the current feature branch, wait for CI checks and preview deployment, then report the preview URL and provisioned GCP resources.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- Current branch is NOT `main`
- Branch has been pushed to origin

## Procedure

When the user asks to create a PR, execute these steps **autonomously**.

### 1. Validate Branch

```bash
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo "ERROR: Cannot create a PR from main."
  exit 1
fi
```

Verify the branch is pushed to origin:

```bash
git push -u origin "$BRANCH" --no-verify 2>/dev/null || true
```

### 2. Gather Context

- Read the spec file if it exists: `specs/<branch-name>/spec.md`
- Run `git log --oneline HEAD --not main` to list commits
- Run `git diff --stat main` to get the file change summary

### 3. Create the Pull Request

Use `gh pr create` with a well-structured body. Extract the feature description from the spec or commits.

```bash
gh pr create \
  --title "feat(<number>): <concise description>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points from spec or commits>

## Preview
Once CI passes, a preview environment will be deployed automatically:
- Cloud Run service: `miximodel-pr-<number>`
- Database: `miximodel_pr_<number>` on shared Cloud SQL
- Preview URL will be commented on this PR

## Test Plan
- [ ] Preview environment loads correctly
- [ ] Key features work as expected
- [ ] No console errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. Wait for CI and Preview Deployment

After the PR is created:

1. Get the PR number from `gh pr create` output
2. Monitor the CI workflow:
   ```bash
   gh run list --branch "$BRANCH" --limit 1 --json status,conclusion,name
   ```
3. Wait for the preview deployment workflow to complete:
   ```bash
   gh run list --branch "$BRANCH" --workflow "preview.yml" --limit 1 --json status,conclusion
   ```
4. Poll every 30 seconds until both workflows complete (max 15 minutes)

### 5. Retrieve Preview URL

Once the preview deployment succeeds, extract the preview URL from the PR comments:

```bash
gh pr view <number> --json comments --jq '.comments[-1].body'
```

Or construct it from the known pattern:

```bash
gcloud run services describe miximodel-pr-<number> --region=europe-west1 --format="value(status.url)"
```

### 6. Report Summary

Present the user with a complete summary:

```
✅ Pull Request Created

PR:       #<number> — <title>
URL:      https://github.com/miximodel/miximodel/pull/<number>
Branch:   <branch-name>
Preview:  <preview-url>

GCP Resources Provisioned:
  Cloud Run:  miximodel-pr-<number> (europe-west1)
  Database:   miximodel_pr_<number> on miximodel-db
  Image:      europe-west1-docker.pkg.dev/miximodel/miximodel/miximodel:pr-<number>

CI Status: ✅ Passed / ⏳ Running / ❌ Failed

These resources will be automatically cleaned up when the PR is closed.
```

### 7. If CI Fails

If CI fails, report the failure with a link to the logs:

```bash
gh run view <run-id> --log-failed
```

Show the failing step and suggest fixes.

## Edge Cases

- If a PR already exists for the branch, show its URL instead of creating a new one
- If the branch has no commits ahead of main, warn the user
- If `gh` is not authenticated, prompt the user to run `gh auth login`
- If preview deployment takes longer than 15 minutes, report the PR URL and suggest checking back later
- If gcloud is not available, skip the resource summary and just report the PR URL
