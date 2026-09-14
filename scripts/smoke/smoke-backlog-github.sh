#!/usr/bin/env bash
# Verify the GitHub-backend backlog scaffolding ships every script the
# PO + grooming contracts depend on. Tests file presence, executable
# bits, and SKILL.md references — no live `gh` calls (the actual
# script behavior against a real repo is covered by integration tests
# and manual QA).
#
# Usage: smoke-backlog-github.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-github.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog github \
  --backlog-url "https://github.com/orgs/example/projects/1" >/dev/null 2>&1)

cd "$DIR"


echo "═══ #69 + #93  backlog backend lock + config ═══"
check "lock records github backend" \
  'grep -q "backlog_backend: github" .specnaut/installed.lock'
check "backlog-config.yml stub present" \
  '[ -f .specnaut/backlog-config.yml ]'

echo
echo "═══ #69  github backend SKILL.md ═══"
check "SKILL renders github backend section" \
  'grep -q "Backend: GitHub" .claude/skills/board/SKILL.md'
check "local backend section stripped (github backend)" \
  '! grep -q "Backend: local Markdown" .claude/skills/board/SKILL.md'
check "no orphan BEGIN markers" \
  '! grep -q "BEGIN: backend=" .claude/skills/board/SKILL.md'

echo
echo "═══ canonical backlog scripts (5 originals) ═══"
# Names carry their `.sh` so the coverage scan can find them. `audit.sh`
# greps each smoke file for a literal basename; a name assembled from a loop
# variable is invisible to it, so this loop covered six scripts while being
# reported as six gaps.
for s in list.sh view.sh add.sh move.sh clarify-comment.sh; do
  check "$s present + executable" "[ -x .specnaut/scripts/backlog/$s ]"
done

echo
echo "═══ #157 + #161  native Project V2 fields (set-field/detect-fields) ═══"
check "detect-fields.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/detect-fields.sh ]'
check "set-field.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/set-field.sh ]'
check "SKILL.md mentions detect-fields.sh (#161)" \
  'grep -q "detect-fields.sh" .claude/skills/board/SKILL.md'
check "SKILL.md mentions set-field.sh (#161)" \
  'grep -q "set-field.sh" .claude/skills/board/SKILL.md'
check "SKILL.md documents set-field exit code 11 fallback contract" \
  'grep -q "10/11/12" .claude/skills/board/SKILL.md'

echo
# --- #561  a warning must be gated on the field existing --------------------
# Date / Estimate are OPTIONAL Project V2 fields the user adds to their own
# board. Instructing the PO to warn "no target date set" unconditionally
# reports a value as unset on boards where it cannot be set at all — noise on
# every item, forever.
#
# A "the file mentions TARGETDATE_FIELD_ID somewhere" check would pass on a
# file whose gate sits three sections away from an ungated warning, so this
# asserts PROXIMITY: every occurrence of the warning string must have the gate
# variable within +/- WINDOW lines.
#
# The zero-occurrence branch exits 2 deliberately. Without it, deleting the
# warning outright would satisfy the check — an assertion that cannot fail,
# which is the class cli#550 exists to hunt.
gated_warning() {
  awk -v warn="$2" -v gate="$3" -v w="${4:-12}" '
    { line[NR] = $0 }
    END {
      hits = 0; bad = 0
      for (i = 1; i <= NR; i++) {
        if (index(line[i], warn) == 0) continue
        hits++
        lo = i - w; if (lo < 1) lo = 1
        hi = i + w; if (hi > NR) hi = NR
        ok = 0
        for (j = lo; j <= hi; j++) if (index(line[j], gate) > 0) { ok = 1; break }
        if (!ok) { printf "ungated \"%s\" at line %d\n", warn, i > "/dev/stderr"; bad++ }
      }
      if (hits == 0) {
        printf "vacuous: \"%s\" occurs nowhere\n", warn > "/dev/stderr"
        exit 2
      }
      exit (bad ? 1 : 0)
    }
  ' "$1"
}

echo "═══ #264  Roadmap dates + Estimate (set-field/detect-fields) ═══"
check "set-field.sh usage advertises StartDate axis (#264)" \
  'grep -q "StartDate" .specnaut/scripts/backlog/set-field.sh'
check "set-field.sh usage advertises TargetDate axis (#264)" \
  'grep -q "TargetDate" .specnaut/scripts/backlog/set-field.sh'
check "set-field.sh usage advertises Estimate axis (#264)" \
  'grep -q "Estimate" .specnaut/scripts/backlog/set-field.sh'
check "set-field.sh dispatches startdate/targetdate/estimate via case (#264)" \
  'grep -qE "startdate \| targetdate \| estimate" .specnaut/scripts/backlog/set-field.sh'
check "set-field.sh wires --date for date axes (#264)" \
  'grep -qE "^[[:space:]]*--date " .specnaut/scripts/backlog/set-field.sh'
check "set-field.sh wires --number for Estimate (#264)" \
  'grep -qE "^[[:space:]]*--number " .specnaut/scripts/backlog/set-field.sh'
check "detect-fields.sh discovers StartDate field via emit_simple (#264)" \
  'grep -qE "^emit_simple \"Start date\"[[:space:]]+STARTDATE$" .specnaut/scripts/backlog/detect-fields.sh'
check "detect-fields.sh discovers TargetDate field via emit_simple (#264)" \
  'grep -qE "^emit_simple \"Target date\"[[:space:]]+TARGETDATE$" .specnaut/scripts/backlog/detect-fields.sh'
check "detect-fields.sh discovers Estimate field via emit_simple (#264)" \
  'grep -qE "^emit_simple \"Estimate\"[[:space:]]+ESTIMATE$" .specnaut/scripts/backlog/detect-fields.sh'
check "detect-fields.sh queries ProjectV2Field for date/number fields (#264)" \
  'grep -q "ProjectV2Field" .specnaut/scripts/backlog/detect-fields.sh'
check "PO agent advertises Target date soft axis (#264)" \
  'grep -qE "\*\*Target date\*\* \(soft" .claude/agents/product-owner.md'
check "PO agent advertises Start date soft axis (#264)" \
  'grep -qE "\*\*Start date\*\* \(soft" .claude/agents/product-owner.md'
check "groom phase mentions Roadmap dates step (#264)" \
  'grep -q "Roadmap dates" .claude/skills/board/groom.md'
check "groom phase report surfaces Roadmap-dates-missing warning (#264)" \
  'grep -qE "no target date set|no start date set" .claude/skills/board/groom.md'

echo
echo "═══ #561  the date warnings are gated on the field existing ═══"
check "groom: every \"no target date set\" sits beside its TARGETDATE_FIELD_ID gate" \
  'gated_warning .claude/skills/board/groom.md "no target date set" TARGETDATE_FIELD_ID'
check "groom: every \"no start date set\" sits beside its STARTDATE_FIELD_ID gate" \
  'gated_warning .claude/skills/board/groom.md "no start date set" STARTDATE_FIELD_ID'
check "PO agent: every \"no target date set\" sits beside its TARGETDATE_FIELD_ID gate" \
  'gated_warning .claude/agents/product-owner.md "no target date set" TARGETDATE_FIELD_ID'
check "PO agent: every \"no start date set\" sits beside its STARTDATE_FIELD_ID gate" \
  'gated_warning .claude/agents/product-owner.md "no start date set" STARTDATE_FIELD_ID'
check "groom step 3a says what to do when the fields are absent" \
  'grep -qF "Both IDs empty" .claude/skills/board/groom.md'
# #562 split the report contract out of groom.md into groom-report.md. These
# assertions follow the TEXT, not the file name — an assertion keyed on a
# location silently stops covering anything the moment its subject moves, and
# it reads as a passing check right up until someone notices.
check "groom report template repeats the condition, so it cannot reintroduce the line" \
  'awk "/Roadmap dates missing \\(GitHub backend, soft\\)/{f=1} f&&/TARGETDATE_FIELD_ID/{ok=1} END{exit !ok}" .claude/skills/board/groom-report.md'
check "groom report: every \"no target date set\" sits beside its TARGETDATE_FIELD_ID gate" \
  'gated_warning .claude/skills/board/groom-report.md "no target date set" TARGETDATE_FIELD_ID'
check "groom report: every \"no start date set\" sits beside its STARTDATE_FIELD_ID gate" \
  'gated_warning .claude/skills/board/groom-report.md "no start date set" STARTDATE_FIELD_ID'
check "groom points at the report contract rather than restating it" \
  'grep -qF "groom-report.md" .claude/skills/board/groom.md'
# #562 split the cloud auto-generation guidance out of the board SKILL.md,
# which is what took the emitted Windsurf workflow 539 characters past the
# vendor cap. The doc ships on every backend; only the pointer to it is
# conditional.
check "spec-autogen contract ships beside the board skill" \
  'test -f .claude/skills/board/spec-autogen.md'
check "spec-autogen keeps the never-fatal rule — a failed spec-gen must not lose the task" \
  'tr "\n" " " < .claude/skills/board/spec-autogen.md | grep -qF "Never fatal to task creation"'
check "spec-autogen says the retry path, not just that it is retryable" \
  'tr "\n" " " < .claude/skills/board/spec-autogen.md | grep -qF "the task stays created"'
check "groom documents detect-fields.sh emitting the date field IDs" \
  'grep -qF "TARGETDATE_FIELD_ID" .claude/skills/board/groom.md'

echo
echo "═══ #553  parent-of.sh — cascade-check read from the other end ═══"
check "parent-of.sh present + executable (#553)" \
  '[ -x .specnaut/scripts/backlog/parent-of.sh ]'
check "it reads parent_issue_url, the field that actually exists (#553)" \
  'grep -qF "parent_issue_url" .specnaut/scripts/backlog/parent-of.sh'
check "no parent and could-not-ask are DIFFERENT exit codes (#553)" \
  'grep -qF "exit 10" .specnaut/scripts/backlog/parent-of.sh &&
   grep -qF "exit 3" .specnaut/scripts/backlog/parent-of.sh'
check "it branches on gh exit status, not on empty stdout (#553)" \
  'grep -qF "api_rc" .specnaut/scripts/backlog/parent-of.sh'
check "SKILL.md documents parent-of.sh and its exit 10 (#553)" \
  'flat="$(tr "\n" " " < .claude/skills/board/SKILL.md)";
   grep -qF "parent-of.sh" <<<"$flat" && grep -qF "exits **10**" <<<"$flat"'

echo "═══ #158  semantic labels bootstrap (ensure-labels.sh) ═══"
check "ensure-labels.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/ensure-labels.sh ]'
check "ensure-labels.sh seeds the canonical 7-label palette in full" \
  'for lbl in security refactor docs tech-debt dx performance dependency; do
     grep -q "ensure_label \"$lbl\"" .specnaut/scripts/backlog/ensure-labels.sh || exit 1;
   done'
check "ensure-labels.sh seeds zero priority:*/size:* labels (#194)" \
  '! grep -E "ensure_label \"(priority|size):" .specnaut/scripts/backlog/ensure-labels.sh'
check "ensure-labels.sh idempotent (skips already-present labels)" \
  'grep -q "already present" .specnaut/scripts/backlog/ensure-labels.sh'
check "ensure-labels.sh verifies the GitHub default '"'"'bug'"'"' label" \
  'grep -qF "bug" .specnaut/scripts/backlog/ensure-labels.sh'
check "SKILL.md mentions ensure-labels.sh (#158)" \
  'grep -q "ensure-labels.sh" .claude/skills/board/SKILL.md'
check "SKILL.md states fields take priority over labels (#194)" \
  'grep -q "reserved as a strict fallback" .claude/skills/board/SKILL.md'

echo
echo "═══ #157  Priority/Size native fields documented in SKILL.md ═══"
check "SKILL.md describes Priority/Size field-first contract" \
  'grep -q "Priority" .claude/skills/board/SKILL.md && grep -q "Size" .claude/skills/board/SKILL.md'

echo
echo "═══ #180  add.sh --parent flag (sub-issues API wiring) ═══"
check "add.sh parses --parent flag" \
  'grep -q -- "--parent" .specnaut/scripts/backlog/add.sh'
check "add.sh references the sub_issues REST endpoint" \
  'grep -q "sub_issues" .specnaut/scripts/backlog/add.sh'

echo
echo "═══ #180  cascade-check.sh present + executable ═══"
check "cascade-check.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/cascade-check.sh ]'
check "cascade-check.sh queries sub_issues for open children" \
  'grep -q "sub_issues" .specnaut/scripts/backlog/cascade-check.sh'
check "cascade-check.sh exits 11 when children block close" \
  'grep -q "exit 11" .specnaut/scripts/backlog/cascade-check.sh'

echo
echo "═══ #202  cascade-check.sh short-circuits on already-closed parent ═══"
check "cascade-check.sh exits 12 when parent already closed" \
  'grep -q "exit 12" .specnaut/scripts/backlog/cascade-check.sh'
check "cascade-check.sh inspects parent state before children" \
  'grep -q "PARENT_STATE" .specnaut/scripts/backlog/cascade-check.sh'

echo
echo "═══ #222  REST/CLI first; raw graphql only for ProjectV2 mutations ═══"
check "list.sh reads via gh issue list --json projectItems (REST-ish CLI)" \
  'grep -q "gh issue list" .specnaut/scripts/backlog/list.sh && grep -q "projectItems" .specnaut/scripts/backlog/list.sh'
check "list.sh does NOT use bulky gh api graphql for the read path" \
  '! grep -q "gh api graphql" .specnaut/scripts/backlog/list.sh'
# The item-ID lookup converged into `_config.sh`'s `project_item_id()` in
# cli#603 — it had three spellings across move.sh and set-field.sh. This
# assertion used to name move.sh and went stale the moment the query moved,
# which is how it sat red for ten commits. It follows the code now: the
# question is "is the lookup still one targeted query", and the answer lives
# where the query does.
check "the item-ID lookup is a single targeted gh api graphql in _config.sh" \
  'grep -q "gh api graphql" .specnaut/scripts/backlog/_config.sh && grep -q "projectItems(first:5)" .specnaut/scripts/backlog/_config.sh'
# Negated on the QUERY, not on the string: move.sh's header comment still
# describes the shared lookup by name, and a bare `! grep projectItems` fails on
# that prose while the code is exactly right.
check "move.sh calls the shared lookup rather than re-spelling it" \
  'grep -q "project_item_id" .specnaut/scripts/backlog/move.sh && ! grep -q "gh api graphql" .specnaut/scripts/backlog/move.sh'
check "move.sh mutation uses gh project item-edit (CLI wrapper)" \
  'grep -q "gh project item-edit" .specnaut/scripts/backlog/move.sh'

echo
echo "═══ #260  Auto-propagate parent Epic on child move (github) ═══"
check "propagate-parent-status.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/propagate-parent-status.sh ]'
check "move.sh invokes propagate-parent-status.sh as tail hook" \
  'grep -q "propagate-parent-status.sh" .specnaut/scripts/backlog/move.sh'
check "propagator resolves parent via GraphQL Issue.parent" \
  'grep -q "parent { number }" .specnaut/scripts/backlog/propagate-parent-status.sh'
check "propagator promotes only Backlog/Ready parents" \
  'grep -qE "\"Backlog\"\|\"Ready\"" .specnaut/scripts/backlog/propagate-parent-status.sh'
check "propagator carries the SPECNAUT_INTERNAL_PROPAGATION recursion guard" \
  'grep -q "SPECNAUT_INTERNAL_PROPAGATION" .specnaut/scripts/backlog/propagate-parent-status.sh'
check "propagator triggers on In-progress/In-review only, not Ready (AC a fidelity)" \
  'grep -qE "\"In progress\"\|\"In review\"\)" .specnaut/scripts/backlog/propagate-parent-status.sh'

echo
echo "═══ #263  Auto-Done propagation in github propagator (static-grep) ═══"
grep -qE '^[[:space:]]*"Done"\)' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator has a NEW_STATUS=Done branch (#263)" \
  || fail "Done branch missing in github propagator" "$(grep -n 'case' .specnaut/scripts/backlog/propagate-parent-status.sh)"
grep -q 'subIssues(first: 100)' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator queries Issue.subIssues for all-Done check" \
  || fail "subIssues query missing in github propagator" "$(grep -n 'subIssues' .specnaut/scripts/backlog/propagate-parent-status.sh)"
grep -q 'fieldValueByName(name: "Status")' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator reads each child's Status via fieldValueByName" \
  || fail "Status fieldValueByName missing in github propagator" "$(grep -n 'fieldValueByName' .specnaut/scripts/backlog/propagate-parent-status.sh)"
grep -q 'all_done=true' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator computes all_done from project Status array" \
  || fail "all_done variable missing in github propagator" "$(grep -n 'all_done' .specnaut/scripts/backlog/propagate-parent-status.sh)"
grep -q '"Ready"|"In progress"|"In review"' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator only auto-advances parents at Ready/In progress/In review (AC a)" \
  || fail "github propagator parent-status guard missing" "$(grep -n 'PARENT_STATUS' .specnaut/scripts/backlog/propagate-parent-status.sh)"

echo "═══ #442  github _config.sh resolves an item URL ═══"
grep -q 'item_url()' .specnaut/scripts/backlog/_config.sh \
  && pass "_config.sh defines item_url (github)" \
  || fail "item_url missing from github _config.sh" "$(grep -n 'item_url' .specnaut/scripts/backlog/_config.sh || true)"
grep -q 'https://github.com/\$REPO/issues/' .specnaut/scripts/backlog/_config.sh \
  && pass "github item_url builds the issue URL from \$REPO" \
  || fail "github item_url does not build an issue URL" "$(grep -n 'github.com' .specnaut/scripts/backlog/_config.sh || true)"

echo
echo "═══ #18  board-drift sweep reports and never moves ═══"
check "sweep-closed.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/sweep-closed.sh ]'
# The trap this script exists to avoid: `gh project item-list --format json`
# nests the repo under `.content.repository`. Filtering on `.repository`
# returns an empty set instead of erroring — which reads as "the board is
# clean" when it is not.
check "sweep reads .content.repository, not .repository" \
  'grep -q "content.repository" .specnaut/scripts/backlog/sweep-closed.sh'
# Detection and correction are deliberately separate: merge pipes DRIFTED
# lines into move.sh. A sweep that moved cards itself could not be run from
# groom, which is read-only.
check "sweep never writes a Status field itself" \
  '! grep -q "updateProjectV2ItemFieldValue" .specnaut/scripts/backlog/sweep-closed.sh'
check "sweep emits DRIFTED / REOPENED / scanned lines" \
  'grep -q "DRIFTED" .specnaut/scripts/backlog/sweep-closed.sh && grep -q "REOPENED" .specnaut/scripts/backlog/sweep-closed.sh && grep -q "scanned" .specnaut/scripts/backlog/sweep-closed.sh'
# `drifted 0` is a quiet run; `scanned 0` means the query matched nothing and
# the silence proves nothing. The two must not be confusable.
check "sweep treats scanned 0 as a failure, not a quiet run" \
  'grep -q "scanned 0" .specnaut/scripts/backlog/sweep-closed.sh'
check "sweep supports --passes for the close-race re-scan" \
  'grep -q -- "--passes" .specnaut/scripts/backlog/sweep-closed.sh'

echo
echo "═══ #18  batched board writes — N cards cost 2 requests ═══"
check "move-batch.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/move-batch.sh ]'
check "move-batch emits an aliased multi-mutation (m0:, m1:, …)" \
  'grep -qE "m\\\$i: updateProjectV2ItemFieldValue" .specnaut/scripts/backlog/move-batch.sh'
check "move-batch reports its request count, so batching is observable" \
  'grep -q "in 2 requests" .specnaut/scripts/backlog/move-batch.sh'
# Deliberate: the batch is a board-state correction, not a lifecycle event.
# Firing the parent-epic hook per card would re-introduce the per-item calls
# this script exists to remove.
check "move-batch does not fire the parent-epic propagation hook" \
  '! grep -q "propagate-parent-status" .specnaut/scripts/backlog/move-batch.sh'

finish "BACKLOG-GITHUB"
