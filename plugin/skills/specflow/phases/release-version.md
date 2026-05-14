
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
depends on how this project publishes releases:

- **GitHub remote** — pipe it into `gh release create <tag>
  --notes-file -` (or `--notes "$(...)"`).
- **GitLab remote** — pipe it into `glab release create <tag>
  --notes "..."`.
- **Local-only** — copy the output somewhere readable (or echo it to
  the user); there is no remote release to create.

The per-backend wrapper scripts ship as separate Specflow features —
when one is installed, prefer it to manually piping into `gh` / `glab`.

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
