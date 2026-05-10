---
name: gh-issues
description: >
  Maintainer-only triage of incoming user-filed GitHub issues
  (label `from:specflow-expert`). Use when Kevin says "triage inbox",
  "groom issues", "list inbound", "promote #N", "reject #N", or
  "dedupe #N". This skill is for the Specflow repo itself — never
  bundle to user projects.
argument-hint: <list|dedupe|promote|reject|groom-inbox> [args]
---

# gh-issues triage skill

Maintainer-side counterpart to the `specflow-expert` agent's bug-report
protocol (#172). The agent files structured issues against
`mkrlabs/specflow` with the `from:specflow-expert` label; this skill
processes the inbox.

**Maintainer-only.** Never lands on user projects. Lives at
`.claude/skills/gh-issues/` in the Specflow repo. Hard-coded to
`mkrlabs/specflow` and the `from:specflow-expert` label.

## Sub-commands

Parse `$ARGUMENTS` as `<subcommand> [rest]`. Run the matching script via
`deno run --allow-run`. Surface its stdout to the user verbatim — it's
already formatted.

### `list`

```
deno run --allow-run .claude/skills/gh-issues/scripts/list.ts
```

Enumerate open issues with label `from:specflow-expert`. Plain table:
`# | YYYY-MM-DD | author | title`.

### `dedupe <num>`

```
deno run --allow-run .claude/skills/gh-issues/scripts/dedupe.ts <num>
```

Top-3 similar issues (open + last 200 closed) by Jaccard token-overlap
on titles. Buckets: `likely-dupe` (≥0.5), `maybe` (≥0.3), `unrelated`.

### `promote <num> [--priority P0..P3] [--size XS..XL]`

```
deno run --allow-run .claude/skills/gh-issues/scripts/promote.ts <num>
```

Defaults: **P3 / M**. Pipeline:

1. Verify `from:specflow-expert` label is present (refuses otherwise).
2. `move.sh <num> Ready`
3. `set-field.sh <num> Priority <P>` (exit 11 → fall back to
   `priority:P3` label, per the existing contract).
4. `set-field.sh <num> Size <S>` (same fallback).
5. Public thank-you comment on the issue.

Override defaults: `--priority P1 --size S`. Kevin reviews and lifts
before final apply via flags — the script doesn't second-guess.

### `reject <num> --reason "..."` — DRY-RUN

```
deno run --allow-run .claude/skills/gh-issues/scripts/reject.ts <num> --reason "..."
```

Prints the public comment and `gh issue close` command that would run.
Does NOT execute. The calling session shows Kevin the output and runs
the printed commands after explicit confirmation. **Hard contract: no
auto-close.**

### `groom-inbox`

```
deno run --allow-run .claude/skills/gh-issues/scripts/groom-inbox.ts
```

Enumerate the inbox + dedupe each issue against open + last 200 closed.
Emit a Markdown table with proposed actions. Kevin reads, replies in
batch (e.g. `175 promote`, `176 reject --reason "dupe of #163"`), and
the calling session dispatches the per-issue scripts.

## Conventions

- All entry-points are Deno scripts. No Bash wrappers — keeps the
  argv parsing testable and the type-checking honest.
- Mutations go through `.claude/skills/backlog/scripts/{move,set-field}.sh`
  — same contract the PO subagent uses. No PO dispatch needed for
  triage actions Kevin has already approved via the groom-inbox table.
- The `from:specflow-expert` label is the inbox gate. The
  `specflow-expert` agent's bug-report protocol auto-applies it via
  the URL pre-fill `&labels=from:specflow-expert`. The
  `.github/ISSUE_TEMPLATE/bug.md` also sets it on manual template-form
  submissions.

## When NOT to use

- For maintainer-filed issues (e.g. things Kevin opens via `/backlog
  add`) — those go through the regular PO flow, not triage.
- For repos other than `mkrlabs/specflow` — hard-coded.
- For batch closures without per-issue review — `reject.ts` enforces
  the dry-run pattern; don't bypass it.

## Tests

Pure unit coverage at `tests/scripts/gh_issues_dedupe_test.ts` (Jaccard
heuristic) and `tests/scripts/gh_issues_argv_test.ts` (promote/reject
arg parsing). End-to-end smoke against the live API is manual — run
`list` after a fresh inbound issue to verify the label filter.
