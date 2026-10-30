
## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
Common natural-language requests:

- `/ship tag` — tag HEAD with the next version
- `/ship tag <sha>` — tag a specific commit
- `/ship tag --bump minor` — SemVer only (also `major` / `patch`)
- `/ship tag --no-push` — skip pushing to `origin`

## What this command does

Creates an annotated tag in the scheme baked in at `specnaut init` (SemVer
`v1.2.3` or date-based `vYY.M.Da`). The bundled script does all the work:

```bash
bash .specnaut/scripts/release/tag.sh "$@"
```

What the script does:

0. Refuses a dirty working tree (tracked changes or untracked files):
   it exits non-zero, lists what is uncommitted, and creates nothing.
1. Runs `git fetch --tags --quiet` so the next-tag computation sees
   every tag that already exists on `origin`.
2. Computes the next tag from the project's scheme:
   - **SemVer** — finds the latest `v*.*.*` tag, applies the bump
     direction from `--bump` (default `patch`), validates the result.
   - **Date-based** — computes today's `vYY.M.D` prefix (no leading
     zeros), scans existing tags for today, increments the letter
     suffix (`a` → `b` → … → `z`, then errors out at 26 same-day tags).
3. Creates an annotated tag with the commit subject in the message.
4. Pushes to `origin` if a remote is configured (use `--no-push` to
   skip).

## What this command does NOT do

- It does **not** publish a release — that is `/ship release`.
- Nor deploy, edit version fields, or run quality gates — see `SKILL.md`,
  "What this skill does not do".

## After running

On a non-zero exit, read stderr — it names what failed.

On success, suggest `/ship release` as the natural next
step. Do NOT run it automatically — releasing is an explicit,
deliberate user action.
