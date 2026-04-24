---
name: miximodel
description: Miximodel umbrella Claude Code skill for driving the production app via its admin APIs. Starts with blog publishing (spec 195 — `/api/blog/*`) and is structured to absorb future admin surfaces (users, flags, media) under the same `/miximodel <domain>-<action>` command shape. Use when the user asks to publish, list, update, or delete a blog article from a local Markdown file, or mentions "miximodel skill", "blog-create", "blog-publish", "publish article".
disable-model-invocation: true
argument-hint: <blog-create|blog-list|blog-show|blog-update|blog-delete|blog-publish> ...
---

# Miximodel Skill

Umbrella skill that drives Miximodel admin operations from Claude Code. The
first domain it covers is **blog publishing** — authoring Markdown locally and
pushing articles to the production API with inline images uploaded
automatically.

Mirrors the `configcat` skill pattern: a sibling `.env` file holds the admin
access token, a bash dispatcher loads it, and a Python implementation does the
HTTP work.

## Setup

1. Generate an admin access token (server-side, Dockerized or prod):

   ```bash
   node ace admin:token:issue <username> --name "miximodel-skill"
   # also accepts an email or a numeric user id
   ```

   Copy the plaintext token that is printed **once** on the last line —
   it cannot be recovered later. The DB only stores a hash. If the command
   warns "not an admin — token will 403 on admin routes", re-run with an
   admin user.

2. Create the skill env file at `.claude/skills/miximodel/.env`:

   ```
   MIXIMODEL_ADMIN_TOKEN="<plaintext-token-from-step-1>"
   MIXIMODEL_API_URL="https://miximodel.com"
   ```

   For local dev, point `MIXIMODEL_API_URL` at `http://localhost:3333`.

3. Verify the wiring with `/miximodel blog-list`.

## Article File Format

Articles are plain Markdown files with YAML frontmatter:

```markdown
---
title: "My article title"
slug: my-article-title           # optional, auto-generated from title
excerpt: "Short teaser displayed on the blog index"
cover_image: ./cover.jpg         # optional, local path — auto-uploaded
status: published                # draft | published (default: published)
published_at: 2026-05-01T10:00:00Z  # optional; omit for immediate publish
---

# Body in Markdown

Inline images use standard Markdown: ![alt text](./screenshot.png)

Any image reference with a relative path (`./`, `../`, or no scheme) is
uploaded to `/api/blog/media` before the article is sent, and its URL is
rewritten to the returned public URL. Remote URLs (`https://...`) are left
untouched.
```

## Slash Commands

- `/miximodel blog-create <path/to/article.md>` — upload images, then POST the
  article. Prints the created article's slug and URL.
- `/miximodel blog-list [--status=published|draft] [--page=N]` — list
  articles (public endpoint, sees only `status=published`; pass `--all` to
  include drafts via the admin path once that endpoint lands).
- `/miximodel blog-show <slug>` — fetch and print one article as JSON.
- `/miximodel blog-update <slug> <path/to/article.md>` — re-upload any changed
  inline images, then PUT the full payload.
- `/miximodel blog-delete <slug>` — soft-delete (DELETE). Irreversible from
  the API.
- `/miximodel blog-publish <slug>` — shortcut: sets `status=published` and
  `published_at=now()` via PUT.

The dispatcher also accepts a raw subcommand for debugging:

- `/miximodel api GET /api/blog` — authenticated raw request, prints JSON.

All commands route through:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/miximodel.sh $ARGUMENTS
```

## Scripts

- `scripts/miximodel.sh` — bash dispatcher. Loads `.env`, validates the
  token is present, delegates to the Python implementation.
- `scripts/blog.py` — Python implementation of all `blog-*` subcommands plus
  the `api` escape hatch. Uses only the standard library (urllib) so no
  `pip install` step is required.

## Operational Rules

- Never commit `.env` from this skill folder (`.claude/skills/**/.env` is
  already gitignored).
- The admin token is equivalent to admin session access to `/api/blog/*` —
  treat it like a password. Rotate with
  `node ace admin:token:revoke` + re-issue.
- Default `MIXIMODEL_API_URL` points at prod. Mutating commands against prod
  are real publications — double-check `blog-list` output before
  `blog-delete`.
- Large media (> 10 MB) is rejected by the API. Resize locally before
  upload.
- This skill is an umbrella. Future domains (`user-*`, `flag-*`) add new
  Python modules under `scripts/` and new command groups in this file —
  they do **not** reshape `miximodel.sh`.

## Reference Docs

- [Blog API quick reference](references/blog_api.md)
