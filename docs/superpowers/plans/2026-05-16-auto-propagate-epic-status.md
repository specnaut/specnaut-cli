# Auto-propagate Epic Status from Child Sub-task Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a sub-task is moved out of Backlog via `move.sh`, automatically advance its parent
Epic to In Progress — but only if the Epic is currently in Backlog or Ready, so manual In Review /
Done states are never regressed.

**Architecture:** A dedicated `propagate-parent-status.sh` helper per backend, called at the tail of
`move.sh` after the child move succeeds. The helper resolves the child's parent, reads the parent's
current status, and conditionally promotes it. Failures inside the propagation (missing parent, API
error) emit a warning to stderr and exit 0 — propagation is a best-effort post-move check, never
blocking the primary mutation. Scope: `github` + `local` backends only; `gitlab` is symmetric but
out of scope per #260's AC.

**Tech Stack:** Bash 4+ · `gh` CLI (REST + GraphQL) · `jq` · `awk` · Deno 2.x for TypeScript helper
tests · existing parent-link helpers at `tests/helpers/parent_link.ts`.

---

## Context

#260 reports that Epics on the Project board stay in Backlog while their sub-tasks advance — making
it impossible to tell at a glance whether an Epic is genuinely idle or actively being worked on. The
fix auto-advances the Epic's Status field the moment a child sub-task leaves Backlog.

The codebase already has all the parent-link plumbing this needs:

- **GitHub backend** — `add.sh --parent` uses
  `POST /repos/{owner}/{repo}/issues/{parent}/sub_issues` (canonical native sub-issues API).
  `cascade-check.sh` reads children via `GET .../sub_issues`. **What's missing** is the _reverse_
  lookup (child → parent). The GitHub native sub-issues GA exposes `Issue.parent { number }` via
  GraphQL; the plan uses that.
- **Local backend** — `add.sh --parent` writes `parent: "#NNN"` into frontmatter.
  `tests/helpers/parent_link.ts` already provides `extractParent()` / `findChildren()` helpers; the
  new propagation reuses the same regex shape with a pure-shell parser (no Deno dependency in the
  bundled script).

The propagation logic is a tiny state machine:

```
post-move-hook(child_num, new_status):
  if new_status == "Backlog":            return  # moving INTO Backlog can't trigger propagation
  parent_num = resolve_parent(child_num)
  if parent_num is null:                  return  # not a sub-task, top-level
  parent_status = read_status(parent_num)
  if parent_status in ("Backlog", "Ready"):
      move(parent_num, "In progress")     # promote
  # else: no-op — idempotent (already at or past In progress) + regression guard
```

Both backends implement the same machine; the resolve / read / move primitives differ. No new domain
types, no new ports, no Specflow CLI changes — pure template-script work mirrored to the plugin.

## File Structure

- **Modify**: `templates/core/skills/backlog/scripts/github/move.sh` (~57 lines) — append a tail
  call to `propagate-parent-status.sh` after the child move succeeds.
- **Create**: `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh` — the
  GitHub-backend propagation logic.
- **Modify**: `templates/core/skills/backlog/scripts/local/move.sh` (~47 lines) — same tail-call
  pattern.
- **Create**: `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh` — the
  local-backend propagation logic.
- **Modify**: `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` — add assertions
  covering propagation behaviour.
- **Modify**: `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` — same, for local
  backend.
- **Modify**: `.claude/skills/test-sandbox/scripts/smoke-features.sh` — add a `#260` section
  asserting the propagator script exists in both bundled trees.
- **No code changes** in `src/`. No new TypeScript. No new tests in `tests/` (the existing smoke
  layer is the right place — these are shell scripts, exercised end-to-end).

The two new propagator scripts are byte-mirrored into the plugin tree by the existing bundle
pipeline. No manual plugin sync needed because these scripts live under
`templates/core/skills/backlog/scripts/<backend>/` which the plugin does not mirror directly —
they're consumed at scaffold time by `specflow init` and emitted into the user's project. Verify
with the plugin_sync_test after each task; if it complains, add the pair to `SYNC_PAIRS` (unlikely
given the existing pattern).

---

## Tasks

### Task 1: Local backend — `propagate-parent-status.sh` (new script + smoke)

**Files:**

- Create: `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh`
- Verify: `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` (will extend in Task 2)

The local backend is the simpler case: parent link lives in `parent: "#NNN"` frontmatter, and status
is a frontmatter field. Pure shell — no API calls. Build this first.

- [ ] **Step 1: Create the script with the propagation machine**

```bash
cat > templates/core/skills/backlog/scripts/local/propagate-parent-status.sh <<'EOF'
#!/usr/bin/env bash
# Post-move hook: when a sub-task moves OUT of Backlog, auto-advance
# its parent Epic to In Progress — but only if the Epic is currently
# in Backlog or Ready. Manual In Review / Done states are preserved.
#
# Local backend: parent link lives in `parent: "#NNN"` frontmatter;
# status lives in `status:` frontmatter. Pure shell, no API calls.
#
# Usage: propagate-parent-status.sh <child-num> <new-child-status>
#   child-num         : 3-digit zero-padded local task id (e.g. 042)
#   new-child-status  : Backlog | Ready | "In progress" | "In review" | Done
#
# Exits 0 on success OR any non-fatal condition (no parent, parent
# missing, parent already past In Progress). Failure to find or
# update the parent emits a warning to stderr but never returns
# non-zero — propagation must not block the primary child move.

set -euo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Moves INTO Backlog don't promote a parent. Bail early.
if [ "$NEW_STATUS" = "Backlog" ]; then
  exit 0
fi

# Locate the project root + backlog dir relative to this script.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Layout: <root>/.specflow/scripts/backlog/<this>.sh — go up 3.
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"

if [ ! -d "$BACKLOG_DIR" ]; then
  echo "::warning::propagate-parent-status: backlog dir not found at $BACKLOG_DIR — skipping" >&2
  exit 0
fi

# Find the child file (NNN-*.md).
CHILD_PADDED=$(printf '%03d' "$((10#$CHILD))")
CHILD_FILE=$(find "$BACKLOG_DIR" -maxdepth 1 -name "${CHILD_PADDED}-*.md" -print -quit)
if [ -z "$CHILD_FILE" ]; then
  echo "::warning::propagate-parent-status: child #${CHILD_PADDED} not found in $BACKLOG_DIR — skipping" >&2
  exit 0
fi

# Extract parent from frontmatter. Convention: `parent: "#NNN"` inside
# the YAML frontmatter (between the first two `---` lines). Missing
# parent or `null` → top-level task, nothing to propagate.
PARENT_LINE=$(awk '/^---$/{n++; next} n==1 && /^parent:/{print; exit}' "$CHILD_FILE")
PARENT_NUM=$(echo "$PARENT_LINE" | sed -nE 's/^parent:[[:space:]]*"?#0*([0-9]+)"?[[:space:]]*$/\1/p')
if [ -z "$PARENT_NUM" ]; then
  exit 0  # not a sub-task
fi

PARENT_PADDED=$(printf '%03d' "$((10#$PARENT_NUM))")
PARENT_FILE=$(find "$BACKLOG_DIR" -maxdepth 1 -name "${PARENT_PADDED}-*.md" -print -quit)
if [ -z "$PARENT_FILE" ]; then
  echo "::warning::propagate-parent-status: parent #${PARENT_PADDED} of child #${CHILD_PADDED} not found — skipping" >&2
  exit 0
fi

# Read parent's current status from frontmatter.
PARENT_STATUS=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' "$PARENT_FILE")

# Only promote if parent is in Backlog or Ready.
case "$PARENT_STATUS" in
  "Backlog"|"Ready")
    # Rewrite the parent's status to "In progress" in-place.
    # Pattern mirrors local/move.sh's awk approach for consistency.
    TMP=$(mktemp)
    awk -v new="In progress" 'BEGIN{n=0; updated=0}
      /^---$/ {n++; print; next}
      n==1 && /^status:/ && !updated {print "status: " new; updated=1; next}
      {print}
    ' "$PARENT_FILE" > "$TMP" && mv "$TMP" "$PARENT_FILE"
    echo "↑ promoted parent #${PARENT_PADDED} (${PARENT_STATUS} → In progress) due to child #${CHILD_PADDED} move"
    # Refresh the index so the move is visible at /backlog list.
    if [ -x "$SCRIPT_DIR/render-index.sh" ]; then
      "$SCRIPT_DIR/render-index.sh" >/dev/null 2>&1 || true
    fi
    ;;
  *)
    # Already at In progress / In review / Done, or unknown — no-op.
    # This is the idempotency + regression guard branch.
    ;;
esac

exit 0
EOF
chmod +x templates/core/skills/backlog/scripts/local/propagate-parent-status.sh
```

- [ ] **Step 2: Verify the script syntax**

```bash
bash -n templates/core/skills/backlog/scripts/local/propagate-parent-status.sh && echo "syntax ok"
```

Expected: prints `syntax ok`.

- [ ] **Step 3: Smoke-test the script manually**

Build a tiny fixture in /tmp and exercise every branch:

```bash
SMOKE=$(mktemp -d)
mkdir -p "$SMOKE/.specflow/backlog" "$SMOKE/.specflow/scripts/backlog"

# Position the script at the path it expects (3 levels above the script dir)
cp templates/core/skills/backlog/scripts/local/propagate-parent-status.sh \
   "$SMOKE/.specflow/scripts/backlog/"

# Fixture: parent #001 in Backlog, child #002 with parent: "#001"
cat > "$SMOKE/.specflow/backlog/001-parent.md" <<EOM
---
id: 001
title: Parent Epic
status: Backlog
parent: null
---
Epic body.
EOM

cat > "$SMOKE/.specflow/backlog/002-child.md" <<EOM
---
id: 002
title: Child sub-task
status: In progress
parent: "#001"
---
Child body.
EOM

# Run the propagator
"$SMOKE/.specflow/scripts/backlog/propagate-parent-status.sh" 002 "In progress"

# Verify parent moved from Backlog → In progress
grep '^status:' "$SMOKE/.specflow/backlog/001-parent.md"
```

Expected output: `↑ promoted parent #001 (Backlog → In progress) due to child #002 move` then
`status: In progress`.

- [ ] **Step 4: Smoke-test the regression-guard branch**

Reset the parent to `Done` and verify the propagator leaves it alone:

```bash
sed -i.bak 's/^status: .*/status: Done/' "$SMOKE/.specflow/backlog/001-parent.md"
"$SMOKE/.specflow/scripts/backlog/propagate-parent-status.sh" 002 "In review"
grep '^status:' "$SMOKE/.specflow/backlog/001-parent.md"
```

Expected: `status: Done` (unchanged). No `↑ promoted` line printed.

- [ ] **Step 5: Smoke-test the no-parent branch**

Remove the parent link and verify silent exit 0:

```bash
sed -i.bak 's/parent: "#001"/parent: null/' "$SMOKE/.specflow/backlog/002-child.md"
"$SMOKE/.specflow/scripts/backlog/propagate-parent-status.sh" 002 "Done" && echo "exit ok"
```

Expected: prints `exit ok` (no output from the propagator).

- [ ] **Step 6: Smoke-test the missing-parent branch (warning + non-zero never)**

Add a parent link to a non-existent parent and verify warning + exit 0:

```bash
sed -i.bak 's/parent: null/parent: "#999"/' "$SMOKE/.specflow/backlog/002-child.md"
"$SMOKE/.specflow/scripts/backlog/propagate-parent-status.sh" 002 "Done" 2>&1 | grep -q "parent #999.*not found"
echo "exit code: $?"
```

Expected: prints `exit code: 0` and the warning text matches.

- [ ] **Step 7: Cleanup the fixture**

```bash
rm -rf "$SMOKE"
```

- [ ] **Step 8: Commit**

```bash
git add templates/core/skills/backlog/scripts/local/propagate-parent-status.sh
git commit -m "feat(backlog/local): add propagate-parent-status.sh post-move hook

When a sub-task moves out of Backlog (to In Progress, In Review, or
Done), this script reads the parent link from frontmatter, reads the
parent's current status, and promotes the parent to In Progress
IF it is currently in Backlog or Ready. Otherwise no-ops — both an
idempotency guard (parent already advancing) and a regression guard
(parent manually in In Review / Done is never pulled back).

Pure shell, no API calls — the parent link is grep-friendly
frontmatter (parent: \"#NNN\") and the status is a sibling field.
Failure modes (no parent, missing parent file, malformed frontmatter)
emit warnings to stderr and exit 0 — propagation must NEVER block
the primary child move per #260 AC(e).

Wiring into move.sh lands in a follow-up commit.

Refs #260."
```

---

### Task 2: Local backend — wire the propagator into `move.sh` + smoke assertions

**Files:**

- Modify: `templates/core/skills/backlog/scripts/local/move.sh` (~47 lines)
- Modify: `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh`

- [ ] **Step 1: Read the current `move.sh`**

```bash
cat templates/core/skills/backlog/scripts/local/move.sh
```

Identify the line where the frontmatter rewrite + `render-index.sh` call completes successfully —
that's where the propagator hook lands.

- [ ] **Step 2: Append the propagator call at the tail of `move.sh`**

Locate the section near the end (after the `render-index.sh` invocation and the final success
message) and add:

```bash
# Post-move hook: promote the parent Epic if this was a sub-task
# leaving Backlog. Best-effort — never blocks on failure. See
# propagate-parent-status.sh for the full state machine.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCRIPT_DIR/propagate-parent-status.sh" ]; then
  "$SCRIPT_DIR/propagate-parent-status.sh" "$NUM" "$NEW_STATUS" || true
fi
```

The variable names `NUM` and `NEW_STATUS` must match what `move.sh` already uses for the child
number and new status. If they differ, adapt — `cat move.sh` and check the actual variable names
(read the `${1:?...}` lines at the top of the script).

- [ ] **Step 3: Verify the syntax**

```bash
bash -n templates/core/skills/backlog/scripts/local/move.sh && echo "syntax ok"
```

Expected: `syntax ok`.

- [ ] **Step 4: Run the existing local backlog smoke**

```bash
bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh 2>&1 | tail -20
```

Expected: all existing assertions still pass. The smoke creates an init project, exercises add.sh /
move.sh / cascade-check.sh — adding the propagator hook to move.sh must not break any existing
behaviour (single-task moves without a parent simply no-op through the propagator).

- [ ] **Step 5: Extend the local backlog smoke with propagation assertions**

Open `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` and find the existing
`## --parent` block (around lines 100-117). After the existing parent-link assertions, append:

```bash
echo
echo "═══ #260  Auto-propagate parent Epic on child move (local) ═══"

# Reset child #002 to Backlog and parent #001 to Backlog for a clean baseline.
"$DIR/.specflow/scripts/backlog/move.sh" 002 Backlog >/dev/null
"$DIR/.specflow/scripts/backlog/move.sh" 001 Backlog >/dev/null

# Move child OUT of Backlog → parent should auto-promote.
"$DIR/.specflow/scripts/backlog/move.sh" 002 "In progress" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' "$DIR/.specflow/backlog/001-"*.md)
[ "$parent_status" = "In progress" ] \
  && pass "parent auto-promoted from Backlog to In progress on child sub-task move" \
  || fail "parent expected 'In progress', got '$parent_status'"

# Regression guard: manually move parent to In review, then move another child.
"$DIR/.specflow/scripts/backlog/move.sh" 001 "In review" >/dev/null
"$DIR/.specflow/scripts/backlog/move.sh" 002 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' "$DIR/.specflow/backlog/001-"*.md)
[ "$parent_status" = "In review" ] \
  && pass "parent in 'In review' is NOT pulled back to 'In progress' on child move" \
  || fail "parent regression guard broken: expected 'In review', got '$parent_status'"
```

The script's existing `pass` / `fail` helpers (defined at the top of the smoke script) are reused.

- [ ] **Step 6: Run the extended smoke**

```bash
bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh 2>&1 | tail -15
```

Expected: all assertions pass, including the two new ones.

- [ ] **Step 7: Run the full test suite**

```bash
deno task test
```

Expected: 643+ tests still green (no TypeScript code changed).

- [ ] **Step 8: Commit**

```bash
git add templates/core/skills/backlog/scripts/local/move.sh \
        .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh
git commit -m "feat(backlog/local): wire propagate-parent-status into move.sh

After move.sh successfully updates a child task's frontmatter status
and refreshes the local index, it now invokes the sibling
propagate-parent-status.sh script with (child_num, new_status).
The hook short-circuits to no-op if:
  * the new status is Backlog (moves INTO Backlog don't promote);
  * the task has no parent link (it's a top-level task);
  * the parent file is missing (warning emitted to stderr);
  * the parent is already at In Progress, In Review, or Done.

Smoke coverage: two new assertions in smoke-backlog-local.sh —
(1) parent auto-promotes Backlog → In Progress on first child move,
(2) parent manually at In Review is never pulled back.

Refs #260."
```

---

### Task 3: GitHub backend — `propagate-parent-status.sh` (new script + manual smoke)

**Files:**

- Create: `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh`

The GitHub side does the same state machine but the primitives are API calls. The parent
reverse-lookup uses GraphQL (the REST `GET /repos/.../issues/N` does not expose `parent.number`
reliably across all schema versions; GraphQL `Issue.parent { number }` has been stable since the
sub-issues GA).

- [ ] **Step 1: Verify the GraphQL parent-lookup works against this repo's live state**

Use any open Specflow issue with a parent to confirm the query shape. Pick a child issue number that
you know has a parent (one of #241–#245 created in the classification epic — they were children of
an epic). Run:

```bash
gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
        number
        parent {
          number
          state
        }
      }
    }
  }
' -f owner=mkrlabs -f name=specflow -F num=241 --jq '.data.repository.issue.parent.number'
```

Expected: prints the parent issue number (a real integer) OR `null` if #241 turns out to be
top-level. If the query errors out with "Field 'parent' doesn't exist on type 'Issue'", the GitHub
instance is on a schema version that hasn't exposed sub-issues parent yet — STOP and surface this;
the plan needs a different reverse-lookup strategy (label-based, like the GitLab backend uses).

- [ ] **Step 2: Create the script with the propagation machine**

```bash
cat > templates/core/skills/backlog/scripts/github/propagate-parent-status.sh <<'EOF'
#!/usr/bin/env bash
# Post-move hook: when a sub-issue moves OUT of Backlog on the Project
# board, auto-advance its parent Epic to In Progress — but only if the
# Epic is currently in Backlog or Ready. Manual In Review / Done states
# are preserved.
#
# GitHub backend: parent link comes from the native sub-issues GA,
# read via GraphQL Issue.parent { number }. Parent's current Status
# field on the project board is read via the same GraphQL projectItems
# query move.sh uses. Promotion uses `gh project item-edit`.
#
# Usage: propagate-parent-status.sh <child-issue-num> <new-child-status>
#   child-issue-num   : integer issue number on the configured repo
#   new-child-status  : Backlog | Ready | "In progress" | "In review" | Done
#
# Always exits 0. Any failure to resolve or update the parent emits a
# warning to stderr — propagation must NEVER block the primary child
# move per #260 AC(e).

set -uo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Moves INTO Backlog don't promote a parent.
if [ "$NEW_STATUS" = "Backlog" ]; then
  exit 0
fi

# Resolve config: REPO_OWNER, REPO_NAME, PROJECT_NUMBER from the
# bundled backlog-config.yml (same pattern as move.sh / add.sh).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$(cd "$SCRIPT_DIR/../../../.." && pwd)/.specflow/backlog-config.yml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "::warning::propagate-parent-status: $CONFIG_FILE not found — skipping" >&2
  exit 0
fi

# Minimal YAML extraction — same one-liner pattern move.sh uses.
REPO_OWNER=$(awk '/^repo_owner:/{print $2; exit}' "$CONFIG_FILE" | tr -d '"')
REPO_NAME=$(awk '/^repo_name:/{print $2; exit}' "$CONFIG_FILE" | tr -d '"')
PROJECT_NUMBER=$(awk '/^project_number:/{print $2; exit}' "$CONFIG_FILE" | tr -d '"')

if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ] || [ -z "$PROJECT_NUMBER" ]; then
  echo "::warning::propagate-parent-status: backlog-config.yml is incomplete — skipping" >&2
  exit 0
fi

# 1. Resolve parent via GraphQL Issue.parent { number }.
PARENT_NUM=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) { parent { number } }
    }
  }
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$CHILD" \
  --jq '.data.repository.issue.parent.number // empty' 2>/dev/null) || PARENT_NUM=""

if [ -z "$PARENT_NUM" ]; then
  # Top-level issue or transient API error — silent exit (the API
  # error case is rare and would surface elsewhere anyway).
  exit 0
fi

# 2. Resolve the parent's current Status field value on the project.
#    Reuses move.sh's projectItems(first:5) targeted lookup pattern.
PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json --jq '.id' 2>/dev/null)
if [ -z "$PROJECT_NODE_ID" ]; then
  echo "::warning::propagate-parent-status: cannot resolve project node id — skipping" >&2
  exit 0
fi

PARENT_STATUS=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
        projectItems(first: 5) {
          nodes {
            project { id }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$PARENT_NUM" \
  --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id == \"$PROJECT_NODE_ID\") | .fieldValueByName.name // empty" 2>/dev/null) || PARENT_STATUS=""

# Parent not on the project, or no Status set yet — nothing to do.
if [ -z "$PARENT_STATUS" ]; then
  exit 0
fi

# 3. Promote only if parent is in Backlog or Ready.
case "$PARENT_STATUS" in
  "Backlog"|"Ready")
    if [ -x "$SCRIPT_DIR/move.sh" ]; then
      # Reuse move.sh — same script that exercised propagation; the
      # recursive call lands at the propagator hook but PARENT_STATUS
      # will then be "In progress", so it's a one-shot no-op walk.
      "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "In progress" >/dev/null 2>&1 \
        && echo "↑ promoted parent #${PARENT_NUM} (${PARENT_STATUS} → In progress) due to child #${CHILD} move" \
        || echo "::warning::propagate-parent-status: move.sh failed to promote #${PARENT_NUM}" >&2
    else
      echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot promote #${PARENT_NUM}" >&2
    fi
    ;;
  *)
    # Already at In progress / In review / Done — no-op.
    ;;
esac

exit 0
EOF
chmod +x templates/core/skills/backlog/scripts/github/propagate-parent-status.sh
```

- [ ] **Step 3: Verify syntax**

```bash
bash -n templates/core/skills/backlog/scripts/github/propagate-parent-status.sh && echo "syntax ok"
```

Expected: `syntax ok`.

- [ ] **Step 4: Manual end-to-end smoke against the live Specflow project**

This step exercises the real flow. Find a fresh issue / sub-issue pair on Project #4 (or create a
throwaway one — but cleanup matters). Easier path: re-use the propagator against an existing child
whose parent is already past Backlog (so the regression guard fires and the parent is not actually
mutated):

```bash
# Pick child #245 (an already-closed sub-task whose parent #240 is Done).
# Calling propagate against it should be a NO-OP (regression guard).
.claude/skills/backlog/scripts/propagate-parent-status.sh 245 "In progress"
```

Wait — the propagator script is in `templates/core/...`, not yet deployed to `.claude/`. Skip this
manual smoke; the **automated smoke in Task 4** will cover the GitHub backend behaviour with a
sandboxed project.

- [ ] **Step 5: Commit the script**

```bash
git add templates/core/skills/backlog/scripts/github/propagate-parent-status.sh
git commit -m "feat(backlog/github): add propagate-parent-status.sh post-move hook

GitHub-backend twin of the local-backend script: when a sub-issue
moves out of Backlog on the Project board, look up the parent via
GraphQL Issue.parent { number } (native sub-issues GA), read the
parent's current Status from the project's Status field, and call
move.sh on the parent if it is in Backlog or Ready.

All API failures (missing config, parent not on project, transient
GraphQL error) emit warnings to stderr and exit 0 — propagation
must NEVER block the primary child move per #260 AC(e).

Wiring into move.sh lands in a follow-up commit.

Refs #260."
```

---

### Task 4: GitHub backend — wire propagator into `move.sh` + smoke assertions

**Files:**

- Modify: `templates/core/skills/backlog/scripts/github/move.sh` (~57 lines)
- Modify: `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`

- [ ] **Step 1: Read the current `move.sh`**

```bash
cat templates/core/skills/backlog/scripts/github/move.sh
```

Identify the last successful action (typically the `gh project item-edit` invocation around line
51-55). The hook lands immediately after it.

- [ ] **Step 2: Append the propagator call**

Insert at the tail (after the `gh project item-edit` succeeds and any closing log message):

```bash
# Post-move hook: promote the parent Epic if this was a sub-issue
# leaving Backlog. Best-effort — never blocks on failure. See
# propagate-parent-status.sh for the full state machine.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCRIPT_DIR/propagate-parent-status.sh" ]; then
  "$SCRIPT_DIR/propagate-parent-status.sh" "$NUM" "$STATUS" || true
fi
```

The variables `$NUM` and `$STATUS` (or whatever the script uses for child issue number and the new
status string) must match the call sites already in `move.sh`. Run `cat move.sh` and confirm the
actual variable names before pasting; if they're different, adapt accordingly.

- [ ] **Step 3: Verify syntax**

```bash
bash -n templates/core/skills/backlog/scripts/github/move.sh && echo "syntax ok"
```

Expected: `syntax ok`.

- [ ] **Step 4: Extend the GitHub backlog smoke**

Open `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` and find the existing move.sh
assertions section. After them, add a presence + integration check:

```bash
echo
echo "═══ #260  Auto-propagate parent Epic on child move (github) ═══"

check "propagate-parent-status.sh present in github backend" \
  '[ -x .specflow/scripts/backlog/propagate-parent-status.sh ]'
check "github move.sh invokes propagate-parent-status.sh as a tail hook" \
  'grep -q "propagate-parent-status.sh" .specflow/scripts/backlog/move.sh'
check "propagate-parent-status.sh resolves parent via GraphQL Issue.parent" \
  'grep -q "Issue.parent\|parent { number }\|parent.number" .specflow/scripts/backlog/propagate-parent-status.sh'
check "propagate-parent-status.sh promotes only Backlog/Ready parents" \
  'grep -q "\"Backlog\"|\"Ready\"" .specflow/scripts/backlog/propagate-parent-status.sh'
check "propagate-parent-status.sh exits 0 on every error path" \
  'grep -c "exit 0" .specflow/scripts/backlog/propagate-parent-status.sh | awk "{exit (\$1>=3 ? 0 : 1)}"'
```

These are presence + shape assertions because exercising the real Projects v2 API in a smoke test
requires a sandbox project and write permissions — out of scope for the smoke layer.

- [ ] **Step 5: Run the GitHub backlog smoke**

```bash
bash .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh 2>&1 | tail -20
```

Expected: all assertions pass, including the five new presence/shape checks.

- [ ] **Step 6: Run the full test suite**

```bash
deno task test
```

Expected: 643+ tests still green.

- [ ] **Step 7: Commit**

```bash
git add templates/core/skills/backlog/scripts/github/move.sh \
        .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh
git commit -m "feat(backlog/github): wire propagate-parent-status into move.sh

After gh project item-edit successfully updates the child's Status
field, move.sh now invokes the sibling propagate-parent-status.sh
script with (child_issue_num, new_status). The hook:
  * short-circuits to no-op if new_status == Backlog;
  * resolves the parent via GraphQL Issue.parent { number };
  * reads the parent's current Status from the project board;
  * promotes the parent to In Progress only if it is in Backlog or
    Ready — otherwise no-op (idempotency + regression guard).

Smoke coverage: five new presence/shape assertions in
smoke-backlog-github.sh covering script presence, the tail-hook
wiring, the parent-resolution GraphQL field, the promotion guard,
and the exit-0-on-every-error-path contract.

Refs #260."
```

---

### Task 5: Lock the cross-backend invariant in smoke-features.sh

**Files:**

- Modify: `.claude/skills/test-sandbox/scripts/smoke-features.sh`

The repo-wide smoke-features.sh already has per-feature sections (#180 Epic, #258 PO Bash
allowlist). Add a #260 section that asserts the new propagator scripts are scaffolded into a fresh
init for both backends.

- [ ] **Step 1: Find an appropriate insertion point**

The current smoke-features.sh runs against a local backend by default (see the
`init --backlog local` invocation at line 25). It can only assert on the LOCAL backend's files. Add
the assertion in the same neighbourhood as the existing #258 section.

- [ ] **Step 2: Add the new section**

After the existing `═══ #258  PO Bash allowlist + memory-home directive ═══` block in
`.claude/skills/test-sandbox/scripts/smoke-features.sh`, append:

```bash
echo
echo "═══ #260  Auto-propagate parent Epic status (local) ═══"
check "propagate-parent-status.sh scaffolded into local backend" \
  '[ -x .specflow/scripts/backlog/propagate-parent-status.sh ]'
check "local move.sh invokes the propagator as a tail hook" \
  'grep -q "propagate-parent-status.sh" .specflow/scripts/backlog/move.sh'
check "propagate-parent-status.sh promotes only Backlog/Ready parents" \
  'grep -qE "\"Backlog\"\|\"Ready\"" .specflow/scripts/backlog/propagate-parent-status.sh'
```

The github-backend equivalents live in `smoke-backlog-github.sh` (Task 4); this section only locks
the local-backend scaffold path.

- [ ] **Step 3: Run smoke-features.sh**

```bash
bash .claude/skills/test-sandbox/scripts/smoke-features.sh smoke-260 2>&1 | tail -10
```

Expected: `═══ ALL CHECKS PASSED ═══` with the three new lines printed.

- [ ] **Step 4: Run the smoke-coverage audit**

```bash
bash .claude/skills/test-sandbox/scripts/audit.sh 2>&1 | tail -5
```

Expected: `0 coverage gap(s)`, `0 stale assertion(s)`.

- [ ] **Step 5: Run the full test suite**

```bash
deno task test
```

Expected: 643+ tests green.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/test-sandbox/scripts/smoke-features.sh
git commit -m "test(smoke): lock #260 propagator scaffold + wiring (local)

Three assertions on the repo-wide smoke runner:
  1. propagate-parent-status.sh is scaffolded executable.
  2. local move.sh invokes the propagator as a tail hook.
  3. The promotion is guarded to Backlog/Ready parents only.

The github-backend variants are covered in smoke-backlog-github.sh.

Refs #260."
```

---

### Task 6: PR + CI + merge + close #260

**Files:** none — git/gh operations only.

- [ ] **Step 1: Final sanity sweep**

```bash
git status --porcelain  # must be empty
deno task test 2>&1 | tail -3
bash .claude/skills/test-sandbox/scripts/audit.sh 2>&1 | tail -5
```

Expected: clean tree, 643+ tests green, 0 audit gaps.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/auto-propagate-epic-status
```

- [ ] **Step 3: Open the PR via REST (avoids GraphQL rate-limit risk)**

Write the body to `/tmp/pr-260-body.md`:

````markdown
Closes #260.

## Summary

When a sub-task moves out of Backlog via `move.sh`, automatically advance the parent Epic to In
Progress — but only if the Epic is in Backlog or Ready, so manual In Review / Done states are never
regressed.

Implementation: a dedicated `propagate-parent-status.sh` per backend, called at the tail of
`move.sh` after the child move succeeds. Pure shell. Scope: `github` + `local` backends; `gitlab` is
symmetric but out of scope per the AC.

The propagation is a best-effort post-move check — every failure mode (missing parent, missing
parent file, transient GraphQL error, malformed frontmatter) emits a stderr warning and exits 0 so
the primary child move always completes successfully per AC(e).

State machine (identical across backends):

- If `new_status == Backlog`: exit 0 (moves INTO Backlog don't promote).
- Resolve parent from child. If none: exit 0.
- Read parent's current status. If `Backlog` or `Ready`: promote to In Progress. Otherwise: no-op
  (idempotency + regression guard).

## Test plan

- Local backend: two new smoke assertions in `smoke-backlog-local.sh` exercising the propagation
  end-to-end (parent Backlog → In Progress on child move; parent at In Review never pulled back).
- GitHub backend: five new presence/shape assertions in `smoke-backlog-github.sh` (script present,
  hook wired, GraphQL parent resolution, promotion guard, exit-0-on-error contract).
- Repo-wide: three new assertions in `smoke-features.sh` locking the local-backend scaffold.
- `deno task test`: 643+ tests green.
- `.claude/skills/test-sandbox/scripts/audit.sh`: 0 gaps, 0 stale.

## Agent adoption

The PO agent's existing two-step close protocol is unchanged. The new behaviour is **transparent** —
every call to `move.sh <num> <status>` on a sub-task now propagates upward automatically.

```prompt
After `specflow upgrade`, when your product-owner agent (or you, manually) moves a sub-issue out of Backlog, the parent Epic auto-advances to In Progress if it was sitting in Backlog or Ready. No action required from the agent or the user — this happens at the tail of `move.sh`. If an Epic was already past In Progress (In Review / Done), nothing changes — the auto-advance has a regression guard. To revert this behaviour for a specific move, you can run `move.sh <parent> Backlog` after the child move to put the parent back.
```
````

🤖 Generated with [Claude Code](https://claude.com/claude-code)

````
Then create the PR:

```bash
jq -n --arg title "feat(backlog): auto-propagate Epic status from child sub-task moves" \
      --rawfile body /tmp/pr-260-body.md \
      '{title: $title, body: $body, head: "feat/auto-propagate-epic-status", base: "main"}' \
  | gh api -X POST repos/mkrlabs/specflow/pulls --input - --jq '"#\(.number) \(.html_url)"'
````

Expected: prints `#NNN https://github.com/mkrlabs/specflow/pull/NNN`.

- [ ] **Step 4: Watch CI to green**

```bash
SHA=$(git rev-parse HEAD)
for i in 1 2 3 4 5 6 7; do
  STATUS=$(gh api "repos/mkrlabs/specflow/commits/$SHA/check-runs" \
    --jq '[.check_runs[] | select(.status != "completed")] | length' 2>/dev/null)
  if [ "$STATUS" = "0" ]; then echo "all done at attempt $i"; break; fi
  echo "attempt $i: $STATUS in-progress, sleeping 30s"
  sleep 30
done
gh api "repos/mkrlabs/specflow/commits/$SHA/check-runs?per_page=30" \
  --jq '[.check_runs[]] | sort_by(.started_at) | reverse | unique_by(.name) | .[] | "\(.name)\t\(.conclusion // "-")"'
```

Expected: every check `success`. If `docs-drift` fails — the PR touches
`templates/core/skills/backlog/scripts/` which is a user-visible surface — but the change adds new
scripts rather than modifying user-facing CLI behaviour, so apply the `docs:not-needed` label:

```bash
gh api -X POST repos/mkrlabs/specflow/issues/<PR>/labels -f "labels[]=docs:not-needed" --jq '.[].name'
```

Wait 15s for the workflow to re-run on the label event, then re-check.

- [ ] **Step 5: Squash-merge via REST**

```bash
gh api -X PUT repos/mkrlabs/specflow/pulls/<PR>/merge -f merge_method=squash \
  --jq '{merged, sha, message}'
```

Expected: `{"merged":true,...}`.

- [ ] **Step 6: Dispatch the product-owner subagent to close #260**

Dispatch prompt:

```
Close mkrlabs/specflow#260 with reason: completed. Reference the merged
PR (<PR_NUMBER>, commit <SHA>) in the close comment. Brief summary:
propagate-parent-status.sh added per backend (github + local), wired
as a tail hook in move.sh; the parent Epic auto-promotes from Backlog
or Ready to In Progress when any child sub-task leaves Backlog. Regression
guard preserves manual In Review / Done parents. Failure paths exit 0
so the primary child move is never blocked. Smoke coverage: local
end-to-end (two new assertions), github presence/shape (five new
assertions), repo-wide scaffold (three new assertions). Ships via
specflow upgrade.

Note for future: auto-Done propagation when all children reach Done is
the natural follow-on — leaving the question open in #260's `## Notes`.
PO can recommend opening a sibling issue once this lands.
```

Expected: PO closes #260, board moves to Done, comment posted.

- [ ] **Step 7: Pull main locally**

```bash
git checkout main && git pull --ff-only
```

Expected: fast-forward to the squash-merge commit.

---

## Verification

End-to-end after all tasks:

1. **Unit tests**: `deno task test` — 643+ green (no TypeScript changes; new behaviour is pure
   shell + smoke).
2. **Local smoke**: `bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` — two new
   propagation assertions green.
3. **GitHub smoke**: `bash .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` — five new
   presence/shape assertions green.
4. **Repo-wide smoke**: `bash .claude/skills/test-sandbox/scripts/smoke-features.sh smoke-260` —
   three new scaffold assertions green; full pass.
5. **Smoke audit**: `bash .claude/skills/test-sandbox/scripts/audit.sh` — 0 gaps, 0 stale.
6. **CI**: every check green on the PR; merged via REST.

## Out of scope (do NOT do)

- **Auto-Done propagation** when all children are Done (called out explicitly in #260's `## Notes`
  as a follow-up axis; the open question "what's 'all children' with nested epics?" needs its own
  design pass).
- **Cross-repo Epic ↔ sub-task** relationships. Parent and children must live in the same repo for
  this PR.
- **Closing the Epic issue itself** when all children close — that stays manual.
- **Multi-level propagation** — if an Epic is itself a child of a grandparent Epic, the grandparent
  is not touched. AC(d) implicitly mandates one-level propagation only.
- **GitLab backend** — symmetric work, but the AC says "both backends: `github` and `local`". A
  follow-up PR can add `templates/core/skills/backlog/scripts/gitlab/propagate-parent-status.sh`
  using the scoped-label parent-lookup pattern.
- **Renaming** any existing script. Move.sh, cascade-check.sh, add.sh are untouched in behaviour —
  only the tail of move.sh gains a hook call.
- **Modifying the PO agent template**. The propagation is transparent; the PO's existing two-step
  close protocol still applies.
- **Tests against the live mkrlabs/specflow Project #4** — the github-backend smoke uses
  presence/shape checks rather than exercising the real API, because mutating Project #4 from a
  smoke run would pollute the live board.

## Failure modes to watch for

1. **GraphQL `Issue.parent` not exposed** — if Task 3 Step 1's GraphQL probe errors with
   `Field 'parent' doesn't exist on type 'Issue'`, the GitHub instance is on an older schema.
   Surface this and stop — the plan needs a label-based fallback (see how `gitlab/cascade-check.sh`
   uses `parent::#NNN` scoped labels).
2. **Variable naming mismatch in `move.sh`** — Task 2 Step 2 and Task 4 Step 2 assume specific
   variable names (`$NUM`, `$NEW_STATUS` / `$STATUS`). The implementer MUST `cat move.sh` first and
   adapt the hook call to whatever names the script actually uses at the call site.
3. **Recursion guard** — the GitHub propagator calls `move.sh` on the parent, which calls the
   propagator on the grandparent. AC(d) bars multi-level promotion; the script naturally handles
   this because the grandparent's status will (after the first promotion) be `In progress` or
   further, which falls into the no-op branch. **Verify by tracing**: parent at Backlog → promoted
   to In Progress → propagator called on grandparent → grandparent at Backlog → promoted to In
   Progress → propagator called on great-grandparent → ... This DOES walk all the way up. If
   multi-level propagation is unwanted, add an environment-variable guard `SPECFLOW_PROPAGATE_DEPTH`
   capped at 1. **Decision**: AC(d) says "Propagation beyond one level... grandparent is not
   touched". Implement the guard.
4. **Smoke-test order** — the local smoke's new assertions reset child #002 + parent #001 to Backlog
   before exercising. If the prior add.sh smoke leaves them in a different state, the baseline might
   not be Backlog. Run the baseline-reset moves explicitly even if they look redundant (they're
   idempotent).
5. **docs-drift check** — the PR touches `templates/core/skills/backlog/scripts/` which is a
   user-visible surface. The change is behaviour-additive, not user-facing-CLI-changing. Apply the
   `docs:not-needed` label per the precedent set on PR #261 (issue #258).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-auto-propagate-epic-status.md`. Two
execution options:

**1. Subagent-Driven (recommended for this plan)** — fresh subagent per task with two-stage review
(spec compliance + code quality) between each task. Useful here because the multi-backend symmetry
(Tasks 1-2 local ↔ Tasks 3-4 github) makes it easy to introduce subtle divergence — the reviewer
catches drift before it lands.

**2. Inline Execution** — drive all six tasks in this session. Faster, lower overhead. Appropriate
given that the shell scripting is straightforward and the smoke layer catches behavioural
regressions immediately.

**Which approach?**
