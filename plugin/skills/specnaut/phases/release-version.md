
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
Common natural-language requests:

- `/specnaut release-version` — generate notes for the latest tag
- `/specnaut release-version v1.2.3` — generate notes for a specific tag
- `/specnaut release-version --baseline v1.2.0` — override the baseline
  (use when the previous tag was never released and you want to skip
  past it; default baseline is the previous tag chronologically)

## What this command does

Generates **categorized release notes** for the given tag (default:
latest) covering every commit between a baseline tag and the target
tag.

The bundled script is stack-agnostic — it just emits the
release-body Markdown to stdout, with one section per non-empty
Conventional-Commits bucket. Run it like this:

```bash
bash .specflow/scripts/release/release.sh "$@"
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

The script writes the release body to **stdout**. What you do with it
depends on how this project publishes releases.

### GitHub remote — prefer the bundled wrapper

If the project ships releases on GitHub, the bundled
`release-github.sh` wrapper is the one-command path:

```bash
bash .specflow/scripts/release/release-github.sh           # latest tag
bash .specflow/scripts/release/release-github.sh v1.2.3    # specific tag
bash .specflow/scripts/release/release-github.sh --draft   # create as draft
bash .specflow/scripts/release/release-github.sh \
  --baseline v1.0.0 v1.2.3                                 # override baseline
```

What the wrapper does on top of `release.sh`:

1. Verifies `gh` CLI is installed + authenticated.
2. **Computes the baseline = previous DEPLOYED tag** (the most recent
   tag with a published GitHub Release attached, NOT the previous
   tag by date). Tags pushed without a release are "subsumed" —
   their commits land in this release and the subsumed tag names
   are listed inline.
3. Pushes the tag to `origin` if not already there (the GitHub
   Releases API needs the tag on the remote).
4. Generates the body via `release.sh` with the computed baseline.
5. Calls `gh release create <tag> --notes-file -` to publish.
6. Prints the published release URL.

Idempotent — re-running against a tag that already has a release
prints the existing URL and exits 0.

### GitLab remote — prefer the bundled wrapper

If the project ships releases on GitLab, the bundled `release-gitlab.sh`
wrapper mirrors the GitHub one:

```bash
bash .specflow/scripts/release/release-gitlab.sh           # latest tag
bash .specflow/scripts/release/release-gitlab.sh v1.2.3    # specific tag
bash .specflow/scripts/release/release-gitlab.sh \
  --baseline v1.0.0 v1.2.3                                 # override baseline
```

Same contract as `release-github.sh`: previous-DEPLOYED-tag baseline
(via `glab api projects/:id/releases`), subsumed-tag listing, tag
auto-push, idempotency. Requires `glab` CLI installed + authenticated
(`glab auth login`).

### Local-only — use the `release-local.sh` wrapper

If the project has no remote (or you just want a Markdown artifact to
paste into any release UI), the bundled `release-local.sh` wrapper
writes the categorized body to a file in the current directory:

```bash
bash .specflow/scripts/release/release-local.sh             # latest tag → RELEASE_NOTES_<tag>.md
bash .specflow/scripts/release/release-local.sh v1.2.3      # specific tag
bash .specflow/scripts/release/release-local.sh --out NOTES.md v1.2.3
```

No remote API calls, no auth, no tag pushing. The output file is the
release-body Markdown — paste it into any release UI, attach it to a
deploy email, or pipe it to a custom publisher. Default output path:
`RELEASE_NOTES_<tag>.md`.

### Custom CI / other remote

Capture `release.sh` output and feed it into whatever your pipeline
expects:

```bash
BODY=$(bash .specflow/scripts/release/release.sh v1.2.3)
# … hand `$BODY` to your custom publisher
```

## From release to production — the deploy model (CD)

Publishing a release and *deploying* are two separate steps. Specnaut owns
the first (tag → notes → publish); this section is the opinionated model
for wiring the second, so that publishing a release **is** what ships
production.

**The rule: production deploys are triggered ONLY by a published release —
never by a push to your default branch.** A push to `main` should at most
run a CI gate (lint / test / build); it must not deploy. A deploy ships the
exact commits bundled between two versions, with the release notes above as
the audit trail. This keeps "what's in production" equal to "the latest
published release", always — no surprise deploy from a stray merge.

### Reference workflow (GitHub Actions)

Stack-agnostic skeleton — fill the `TODO`s with your own install / build /
deploy commands (any target: a PaaS, a container registry, an SSH rsync, a
serverless CLI). The **shape** is the opinionated part, not the tooling:

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

Keep the lint/build/test gate in its own workflow on `push` /
`pull_request`. It runs on every change but **never deploys**:

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

### Why this shape

- **Release-only trigger** — "what's deployed" is exactly "the latest
  published release". No deploy fires from a branch push.
- **Least-privilege `permissions: contents: read`** — a compromised step
  can't rewrite the repo.
- **`concurrency` (no cancel-in-progress)** — back-to-back releases deploy
  in order; an in-flight deploy is never cut off half-applied.
- **Per-step secrets** — credentials never enter steps that don't need them.
- **Build/output gate** — catch a dev/staging endpoint before it ships.
- **`if: github.repository == …`** — a fork can't run your production deploy.

**Break-glass** (re-deploy without cutting a new tag): re-run the last
release's deploy run from the Actions UI — it redeploys the same ref. There
is deliberately no manual `workflow_dispatch` in the model above, so prod is
only ever reached through a release.

> GitLab CI mirrors this: a `release` rule (`if: $CI_COMMIT_TAG` gated to a
> protected tag + a `release:` job) instead of `on: release`, a
> `resource_group` instead of `concurrency`, and masked/protected CI
> variables instead of `secrets`.

## Important — release-notes contract

The script emits the body verbatim. Do NOT:

- Reword sections / re-categorize commits after the fact. If a commit
  message is wrong (e.g. `feat:` for what's really a `fix:`), the
  correct move is to amend the commit message **before** tagging,
  not to hand-edit the release body.
- Add a raw `git diff` or `git log` dump. The whole point of this
  command is that the body is human-readable on its own.
- Run release publication without showing the user the generated body
  first when invoked interactively. The body is the production
  artifact — surface it for review before posting.

## Workflow

```
/specnaut tag-version             → annotated tag created + pushed
/specnaut release-version         → categorized release notes (stdout)
↳ pipe to gh/glab release create  → release published
   └─ (optional CD) a `release: published` job deploys production —
      see "From release to production" above
```
