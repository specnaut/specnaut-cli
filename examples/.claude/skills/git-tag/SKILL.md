---
name: git-tag
description: Create a date-based Git tag (vYY.M.D + letter suffix) on the current or specified commit and push it to the remote. Use when the user asks to "tag", "create a tag", "git tag", "tag this commit", or "release tag".
---

# Git Tag — Date-Based Release Tagging

Create an auto-incremented date-based Git tag following the format `vYY.M.D[a-z]` and push it to the remote.

## Tag Format

| Part   | Description                        | Example |
| ------ | ---------------------------------- | ------- |
| `v`    | Literal prefix                     | `v`     |
| `YY`   | 2-digit year                       | `26`    |
| `M`    | Month, **no leading zero**         | `3`     |
| `D`    | Day, **no leading zero**           | `28`    |
| letter | Incremental suffix starting at `a` | `a`     |

**Full example:** `v26.3.28a` (first tag on March 28, 2026), `v26.3.28b` (second tag same day).

## Validation Regex

Every generated tag **must** pass this regex before being applied:

```
^v\d{2}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])[a-z]$
```

## Procedure

When the user asks to tag a commit, execute the **tag.sh** script located alongside this skill file.

### Usage

```bash
# Tag HEAD (default)
bash .claude/skills/git-tag/scripts/tag.sh

# Tag a specific commit
bash .claude/skills/git-tag/scripts/tag.sh <commit-sha>
```

### What the script does

1. **Runs all quality gates** (format, lint, typecheck, tests) via the `code-review` skill — aborts if any check fails
2. Fetches remote tags (`git fetch --tags`)
3. Computes today's prefix `vYY.M.D` (no leading zeros)
4. Scans existing tags for today, finds the highest letter suffix
5. Increments the letter (`a` -> `b` -> `c` ... up to `z`)
6. Validates the generated tag against the regex
7. Shows a summary (tag name, commit SHA, commit message)
8. Creates an annotated tag and pushes to origin
9. Prints the GitHub release URL if applicable

### Before running

- Confirm with the user which commit to tag (HEAD or a specific SHA)
- Show the expected tag name from a dry mental calculation if useful

### After running

Display the output to the user. If the script fails, read the error and diagnose.

**Important**: Pushing a tag only triggers a Docker image build via Cloud Build. It does NOT deploy to production. To deploy, the user must create a **GitHub Release** for the tag, which triggers the `deploy.yml` workflow (Pulumi + migrations + Telegram notification).

## Edge Cases

- If the letter reaches `z` (26 tags in one day), the script aborts with an error.
- If no remote is configured, the push will fail — tag locally and warn the user.
- If the user specifies a commit SHA, pass it as the first argument to the script.
