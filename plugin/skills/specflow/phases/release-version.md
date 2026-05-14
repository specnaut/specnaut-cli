
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
Common natural-language requests:

- `/specflow release-version` — generate notes for the latest tag
- `/specflow release-version v1.2.3` — generate notes for a specific tag
- `/specflow release-version --baseline v1.2.0` — override the baseline
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

### Other backends (no wrapper installed)

- **GitLab remote** — pipe `release.sh` output into
  `glab release create <tag> --notes "$(bash .specflow/scripts/release/release.sh <tag>)"`.
- **Local-only** — copy `release.sh` output somewhere readable; there
  is no remote release object to create.

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
/specflow tag-version             → annotated tag created + pushed
/specflow release-version         → categorized release notes (stdout)
↳ pipe to gh/glab release create  → release published
```
