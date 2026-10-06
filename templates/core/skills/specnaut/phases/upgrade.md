# /specnaut upgrade

## User Input

```text
$ARGUMENTS
```

Flags: `--dry-run` (show the plan, change nothing), `--no-self-update` (keep the installed
binary), `--force` (passed through to `specnaut upgrade`; only when the user typed it).

## What this phase is

`specnaut upgrade` rewrites the project's Specnaut files from the templates bundled in the
**installed binary**. So an upgrade is two moves: the binary first, then the project. This phase
does both, from inside the session, and leaves one commit behind. It is one-shot: it never chains.

Run every command from the project root, and report what the commands printed — never what you
expected them to print.

## Steps

1. **The binary is there.** `command -v specnaut`. If it is missing, stop and give the install
   line: `curl -fsSL https://specnaut.com/install.sh | bash`. Do not install it yourself.

2. **The tree is clean.** `git status --porcelain`. If it is not empty, the upgrade still runs,
   but step 7 does not commit — an upgrade folded into unrelated uncommitted work cannot be
   reviewed or reverted on its own. Say so in one line.

3. **The binary is current** (skip under `--no-self-update`). Run `specnaut self-update --check`.
   If a newer release is published, run `specnaut self-update`: it verifies the release signature
   before it replaces anything. Report `<old> → <new>`. A failed self-update is reported, and the
   phase continues with the installed binary — the project can still reach that version.

4. **The plan.** `specnaut upgrade --dry-run`. Under `--dry-run`, print it and stop here. Otherwise
   read it: which files are rewritten, which are customised and kept, which are removed.

5. **The upgrade.** `specnaut upgrade` (add `--force` only if the user passed it: it overwrites
   customised files, keeping a `.specnaut.bak` of each). Keep its whole output. Lines starting
   with `⚠` are refusals and lines starting with `ℹ` are notes — a plugin the upgrade enabled, a
   marketplace it re-pinned. Every one of them goes into the report, verbatim.

6. **The result holds.**
   - `specnaut reconcile --status` — files kept because they were customised, now waiting for a
     decision. List each with the two ways out: `specnaut reconcile <path> --accept-upstream` or
     `--accept-current`. Do not choose for the user: the customisation is theirs.
   - `specnaut check --project` — it must pass. If it fails, report the failure and do not commit.

7. **One commit.** On a clean start (step 2) and a passing check, stage everything the upgrade
   changed and commit it on the current branch:
   `chore(specnaut): upgrade to v<version>`. Do not push: an upgrade lands like any other change.

8. **The report.** In this order: binary `<old> → <new>` (or "already current"), templates
   `<from> → <to>`, files written, files kept as customised, pending reconciliations, the `⚠` and
   `ℹ` lines, the commit hash. Then one line on what the session does not see yet: the skills and
   agents it loaded at start are the old ones — in Claude Code, `/reload-plugins` or a new session
   picks up the new ones; in another harness, start a new session.

## Never

- Never edit a Specnaut-managed file by hand to "finish" an upgrade. If `specnaut upgrade` refused
  something, the refusal is the result; report it.
- Never run `--force` or `--reset-baseline` on your own initiative. Both discard a decision the
  project made.
