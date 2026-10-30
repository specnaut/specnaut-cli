
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
Common natural-language requests:

- `/ship release` — generate notes for the latest tag
- `/ship release v1.2.3` — generate notes for a specific tag
- `/ship release --baseline v1.2.0` — override the baseline (default: the
  previous tag)

## What this command does

Writes **categorized release notes** for the tag (default: latest) to stdout —
every commit since the baseline, one section per non-empty Conventional-Commits
bucket:

```bash
bash .specnaut/scripts/release/release.sh "$@"
```

## Buckets (fixed order, empty buckets omitted)

1. **Features** — `feat:` / `feat(scope):` / `feat!:`
2. **Bug Fixes** — `fix:` / `fix(scope):` / `fix!:`
3. **Performance** — `perf:`
4. **Refactors** — `refactor:`
5. **Documentation** — `docs:`
6. **Tests** — `test:`
7. **Build & CI** — `build:` / `ci:`
8. **Chores** — `chore:`
9. **Style** — `style:`
10. **Other** — anything that does not match a Conventional-Commits prefix

Each commit appears as `- <short-sha> <subject>` under its bucket.

## After the script runs

### GitHub remote — prefer the bundled wrapper

One command:

```bash
bash .specnaut/scripts/release/release-github.sh           # latest tag
bash .specnaut/scripts/release/release-github.sh v1.2.3    # specific tag
bash .specnaut/scripts/release/release-github.sh --draft   # create as draft
bash .specnaut/scripts/release/release-github.sh \
  --baseline v1.0.0 v1.2.3                                 # override baseline
```

What the wrapper does on top of `release.sh`:

1. Verifies `gh` CLI is installed + authenticated.
2. **Computes the baseline = previous DEPLOYED tag** (the latest tag with a
   published Release — drafts do not count — NOT the previous tag by date).
   Unreleased tags in between are "subsumed" and listed inline.
3. Pushes the tag to `origin` if not already there.
4. Generates the body via `release.sh` with the computed baseline.
5. Calls `gh release create <tag> --notes-file -` to publish.
6. Reports the state GitHub holds, not the flag passed: a draft prints
   `draft release created (not published)`. Last line, machine-readable:
   `created draft=<bool> url=<url>`.

Idempotent — a re-run adopts an existing release and prints
`exists draft=<bool> url=<url>`, exit 0. Read `exists` and `draft=` before
touching the body: a published release is live. `--fail-if-exists` refuses
to adopt (exit 3).

**Publishing always prompts.** On Claude Code the scaffolded settings carry
`ask` rules for `gh release create`, `gh release edit … --draft…` and
`gh run rerun`. `ask` beats `allow`, so a broad `gh release *` you add to
run `/ship` unattended still stops at the one step you cannot take back.

### GitLab remote — prefer the bundled wrapper

Mirrors the GitHub one:

```bash
bash .specnaut/scripts/release/release-gitlab.sh           # latest tag
bash .specnaut/scripts/release/release-gitlab.sh v1.2.3    # specific tag
bash .specnaut/scripts/release/release-gitlab.sh \
  --baseline v1.0.0 v1.2.3                                 # override baseline
```

Same contract as `release-github.sh`: previous-DEPLOYED-tag baseline
(via `glab api projects/:id/releases`), subsumed-tag listing, tag
auto-push, idempotency. Requires `glab` CLI installed + authenticated
(`glab auth login`).

### Local-only — use the `release-local.sh` wrapper

No remote: writes the body to a file (default `RELEASE_NOTES_<tag>.md`). No API
calls, no auth, no tag push.

```bash
bash .specnaut/scripts/release/release-local.sh             # latest tag → RELEASE_NOTES_<tag>.md
bash .specnaut/scripts/release/release-local.sh v1.2.3      # specific tag
bash .specnaut/scripts/release/release-local.sh --out NOTES.md v1.2.3
```

### Custom CI / other remote

Capture `release.sh` output:

```bash
BODY=$(bash .specnaut/scripts/release/release.sh v1.2.3)
# … hand `$BODY` to your custom publisher
```

## From release to production — the deploy model (CD)

Specnaut publishes; this is the model for wiring the deploy, so that publishing
a release **is** what ships production.

**The rule: production deploys are triggered ONLY by a published release —
never by a push to your default branch.** A push to `main` should at most
run a CI gate (lint / test / build); it must not deploy.

### Reference workflow (GitHub Actions)

Fill the `TODO`s with your own commands; the **shape** is the opinionated part:

```yaml
# .github/workflows/deploy-prod.yml
name: deploy-prod
on:
  release:
    types: [published]   # ONLY a published release deploys. No `push:` trigger.

# Least privilege: the deploy authenticates to your provider via secrets,
# not the GITHUB_TOKEN. Grant nothing it doesn't need.
permissions:
  contents: read

# Never run two prod deploys at once; queue the newer one, don't cancel a
# half-applied deploy mid-flight.
concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.repository == 'OWNER/REPO'   # a fork that copied this can't deploy your prod
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4          # or your toolchain's setup
        with: { node-version: 22, cache: npm }
      - run: <install>                       # TODO e.g. npm ci
      - name: Build
        run: <build>                         # TODO produce the production artifact
      - name: Gate — assert the prod artifact
        run: |
          # Optional but recommended: fail if a dev/staging endpoint leaked
          # into the build before it ships. Example:
          #   ! grep -rq 'staging.internal' dist/ || { echo 'dev URL in bundle'; exit 1; }
          true
      - name: Deploy
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}   # secrets only on the step that needs them
        run: <deploy>                        # TODO ship it
```

### Companion CI gate (separate file)

On `push` / `pull_request`; it **never deploys**:

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: <install> && <lint> && <build>   # TODO your gate commands
```

**Break-glass** (re-deploy without a new tag): re-run the last release's deploy
run from the Actions UI. There is deliberately no `workflow_dispatch`, so prod is
only ever reached through a release.

> GitLab CI mirrors this: a `release` rule (`if: $CI_COMMIT_TAG` gated to a
> protected tag + a `release:` job) instead of `on: release`, a
> `resource_group` instead of `concurrency`, and masked/protected CI
> variables instead of `secrets`.

## Important — release-notes contract

The script emits the body verbatim. Do NOT:

- Reword sections / re-categorize commits after the fact. A wrong commit
  message is amended **before** tagging, not hand-edited in the body.
- Add a raw `git diff` or `git log` dump.
- Run release publication without showing the user the generated body
  first when invoked interactively — surface it for review before posting.
