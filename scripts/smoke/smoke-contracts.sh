#!/usr/bin/env bash
# Check the shared contracts and the always-on context file as scaffolded into a
# fresh Claude project on the local backend: the backlog-reference, output,
# mobile-first and response-style contracts, the review-seat gate, the phase
# addenda, and what AGENTS.md points at. Moved out of smoke-features.sh by
# #703, which had grown past its size ceiling.
#
# Usage: smoke-contracts.sh <name>
#   <name> is the sandbox scenario name (will be created/wiped).
set -euo pipefail

NAME="${1:?usage: smoke-contracts.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Wipe the scenario directory on every exit path, success or failure.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ #442  Backlog references name the item, not just its number ═══"
# Repointed off the retired command shim (#533), which the board skill
# replaced. The absence check was passing vacuously against the missing file —
# `! grep` on a path that does not exist succeeds.
check "the backlog skill exists to be checked at all" \
  '[ -f .claude/skills/task/SKILL.md ] && [ -f .claude/skills/task/backlog.md ]'
check "the backlog skill points at the backlog-reference-contract" \
  'grep -q "backlog-reference-contract" .claude/skills/task/SKILL.md'
check "the backlog skill does not restate the rule (single canonical copy)" \
  '! grep -q "Never a number alone" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'
# The negative alone made deleting the rule from the product turn the suite
# GREENER. A rule asserted only by its absence elsewhere is not asserted.
check "and the rule itself exists where it is supposed to live" \
  'grep -q "Never a number alone" .claude/skills/backlog-reference-contract/SKILL.md'

echo
echo "═══ #551 / cli#679  the harness-specific tree the scan never looked at ═══"
# #551 gave the security-guidance plugin files their first assertions; cli#679
# retired both (Specnaut's hooks and settings read neither). Absence is checked
# by scaffolding, with the folder's presence checked first so the negatives
# cannot pass against a tree that was never written.
check "the .claude/ folder scaffolds, so the absence checks below mean something" \
  '[ -f .claude/settings.json ]'
check "the retired security-guidance context file no longer scaffolds (cli#679)" \
  '[ ! -e .claude/claude-security-guidance.md ]'
check "the retired per-edit pattern file no longer scaffolds (cli#679)" \
  '[ ! -e .claude/security-patterns.yaml ]'

echo
echo "═══ #612 / cli#680  the context file is AGENTS.md, and points only at what was scaffolded ═══"
check_context_file local
check "AGENTS.md carries the backlog section, rendered for its backend (cli#680)" \
  'grep -q -- "<!-- --- Specnaut: backlog --- -->" AGENTS.md && grep -q "\.specnaut/backlog\.md" AGENTS.md && ! grep -q "backend=" AGENTS.md'
check "AGENTS.md's optional-integrations section points at the written reference (cli#680, cli#679)" \
  'grep -q -- "<!-- --- Specnaut: optional-integrations --- -->" AGENTS.md && grep -q "\.claude/skills/specnaut-facts/integrations\.md" AGENTS.md && grep -q "^## Claude Code" .claude/skills/specnaut-facts/integrations.md'

echo
echo "═══ #23  a silent review seat fails the gate ═══"
# The not-run state has ONE representation and it is arithmetic: a prose note
# beside an all-zero block reads as clean to whatever sums it. Every assertion
# here anchors on a behavioural sentence, never on a heading — deleting the
# rule beneath a heading used to leave two of these green.
check "the seat caps Step 0 so the budget reaches the files" \
  'grep -q "at most four reads in Step 0" .claude/agents/security-expert.md'
# monorepo#28 re-anchored this. It used to pin the literal
# `no findings — checks performed:`, which existed on ONE seat — the per-agent
# convention that made a coordinator-side check impossible to write. The shape
# now lives in the contract as `EVIDENCE`, so the assertion sweeps every seat
# instead of naming the one that happened to have it.
check "a clean verdict has a shape of its own, on every seat" \
  'for a in accessibility-expert architect-expert code-reviewer dependency-expert \
            performance-expert security-expert; do
     grep -qF "EVIDENCE" ".claude/agents/$a.md" || exit 1
   done'
check "the contract, not an agent, defines what a clean verdict names" \
  'grep -qF "EVIDENCE" .claude/skills/review-findings-contract/SKILL.md'
check "and it states the limit the check leaves behind" \
  'grep -qF "did it look at all" .claude/skills/review-findings-contract/SKILL.md'
check "and could-not-look is reported as a COUNT, not only as prose" \
  'grep -qF "SEATS_REPORTED: 0" .claude/agents/security-expert.md'
check "the seat is forbidden from saying NOT RUN without the count" \
  'grep -q "Never emit the words .NOT RUN. without" .claude/agents/security-expert.md'
check "the contract can express that nobody looked" \
  'grep -q "SEATS_EXPECTED" .claude/skills/review-findings-contract/SKILL.md && grep -q "SEATS_REPORTED" .claude/skills/review-findings-contract/SKILL.md'
check "and a missing seat fails by arithmetic, not by interpretation" \
  'grep -qF "SEATS_REPORTED < SEATS_EXPECTED" .claude/skills/review-findings-contract/SKILL.md'
check "which seats are required is defined, not left to judgement" \
  'grep -q "Required seats, so the word is not left" .claude/skills/task/phases/review-seats.md'
check "a skipped seat is distinguished from a missing one" \
  'grep -q "skipped seat is not a missing one" .claude/skills/task/phases/review.md'
# A SWEEP, not a case. The contract gained two fields and six of the eight
# seats kept describing the old block — an honest review would then have
# counted six seats as not-reporting. Third instance in two days of an
# enumeration stopping one short, so this counts every seat rather than
# naming the ones that were wrong at the time.
check "every review seat names the seat-count fields, not just the ones fixed" \
  'n=0; for a in .claude/agents/*expert.md .claude/agents/code-reviewer.md; do grep -q "REVIEW_VERDICT" "$a" || continue; grep -q "SEATS_EXPECTED" "$a" || n=$((n+1)); done; [ "$n" -eq 0 ]'
check "a stale seat block does not fail an honest gate" \
  'grep -q "counts as .*one" .claude/skills/task/phases/review-seats.md'
check "the aggregation's own restatement carries the third trigger too" \
  'grep -qF "SEATS_REPORTED < SEATS_EXPECTED" .claude/skills/task/phases/review-seats.md'
check "the review may not present its own checking as a seat report" \
  'grep -qF "Your own verification is not a seat report" .claude/skills/task/phases/review-seats.md'
# AC4 — the option deliberately NOT taken. Without an assertion, deleting the
# refusal is invisible and an automatic retry creeps back in.
check "no automatic re-dispatch: zero findings stays a legitimate result" \
  'grep -q "zero findings can be a" .claude/skills/task/phases/review-seats.md'
# The consumer of the gate. Without this the aggregation can say fail and the
# chain still reaches the merge prompt.
check "the review phase stops the run when a seat did not report" \
  'grep -qF "SEATS_REPORTED <" .claude/skills/task/phases/review.md'
check "and re-dispatching narrower is allowed, repeating the brief is not" \
  'grep -qF "repeating the same brief is not a remedy" .claude/skills/task/phases/review-seats.md && grep -qF "§ Your own checking, and re-dispatch" .claude/skills/task/phases/review.md'
# #678 — the coordinator's fan-out moved into the review phase itself.
check "the review fans its seats out by name under the concurrency cap" \
  'grep -qF "in flight, and never more than the harness" .claude/skills/task/phases/review.md && grep -qF "collect-audit-scope.sh --range" .claude/skills/task/phases/review.md'
check "a seat brief carries data, never the diff's own text" \
  'grep -qF "never diff hunks or commit message bodies" .claude/skills/task/phases/review-seats.md'
check "and only a seat's last REVIEW SUMMARY block counts" \
  'grep -qF "Only the last \`REVIEW SUMMARY\` block" .claude/skills/task/phases/review-seats.md'

echo "═══ #547  the thirteen skills nothing asserted on ═══"
# These shipped covered by an audit that could not fail: every skill's file
# is named SKILL.md, so its basename identified nothing. Each assertion below
# names what the skill PROMISES — a presence check would satisfy the coverage
# token and close none of the hole, which is this feature's own defect coming
# back through the door marked done.

# --- the five output contracts define a named machine-readable block -----
check "workflow-contract .claude/skills/workflow-contract/SKILL.md is not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/workflow-contract/SKILL.md'
# #678: WORKFLOW STATUS keeps only what the log hook and the developer parse.
check "workflow-contract defines WORKFLOW STATUS with only its parsed keys" \
  'f=.claude/skills/workflow-contract/SKILL.md; grep -q "WORKFLOW STATUS" $f && grep -q "^DONE_CRITERIA_MET:" $f && grep -q "^STATE:" $f && grep -q "^HANDOFF_TARGET:" $f && grep -q "^BLOCKERS:" $f && ! grep -qE "^(SUMMARY|ARTIFACTS|FILES_CHANGED|VALIDATION|NEXT_ACTION):" $f'
# #678: blocks nothing parsed, and a triage mode nothing dispatched. Its gh-api
# allowlist was the only limit on security-expert's Bash, so the grant left too.
for retired in alert-triage-contract qa-report-contract handoff-protocol; do
  check "retired contract $retired is neither scaffolded nor preloaded" \
    "[ ! -e .claude/skills/$retired ] && ! grep -q '^skills:.*$retired' .claude/agents/*.md"
done
check "security-expert grants no Bash once its allowlist is gone" \
  'grep -q "^tools: " .claude/agents/security-expert.md && ! grep -q "^tools:.*Bash" .claude/agents/security-expert.md'
# #562 — sections split out of seats; each ships preloaded, not user-invoked.
check "backlog-frontmatter ships and is preloaded, not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/backlog-frontmatter/SKILL.md'
check "product-owner preloads backlog-frontmatter" \
  'grep -q "^skills:.*backlog-frontmatter" .claude/agents/product-owner.md'
check "specnaut-facts ships and is preloaded, not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/specnaut-facts/SKILL.md'
check "specnaut-guide preloads specnaut-facts" \
  'grep -q "^skills:.*specnaut-facts" .claude/agents/specnaut-guide.md'

check "review-findings-contract .claude/skills/review-findings-contract/SKILL.md is not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/review-findings-contract/SKILL.md'
check "review-findings-contract requires a verdict and a CRITICAL count" \
  'grep -q "REVIEW_VERDICT:" .claude/skills/review-findings-contract/SKILL.md && grep -q "CRITICAL_COUNT:" .claude/skills/review-findings-contract/SKILL.md'
# "number, title" matched only the frontmatter description, so the entire
# Format and Rules body was deletable with this green. Anchored on the
# canonical rendering instead.
check "backlog-reference-contract .claude/skills/backlog-reference-contract/SKILL.md defines the canonical rendering" \
  'grep -qF "[#<number> — <title>](<url>)" .claude/skills/backlog-reference-contract/SKILL.md'

# --- #576: mobile-first is the assumed default ------------------------------
# The contract ships as one file and is reached by pointer. What the smoke can
# see that the unit suite cannot is the SCAFFOLDED result: the file a user
# actually receives, at the path their harness puts it.
check "mobile-first-contract .claude/skills/mobile-first-contract/SKILL.md ships" \
  'test -f .claude/skills/mobile-first-contract/SKILL.md'
check "mobile-first-contract states the default and its opt-out" \
  'grep -q "A default, not a mandate" .claude/skills/mobile-first-contract/SKILL.md'
# The opt-out is the project's to declare, never shipped: the scaffolded
# constitution at docs/constitution.md carries no live declaration. `test -f`
# first, or a missing file would pass the negative grep.
check "the scaffolded constitution does not ship a live opt-out declaration" \
  'test -f docs/constitution.md && ! grep -q "This project targets" docs/constitution.md'
check "AGENTS.md carries the ui-defaults managed section" \
  'grep -q "Specnaut: ui-defaults" AGENTS.md'
check "the ui-defaults block points at the contract" \
  'grep -q "mobile-first-contract" AGENTS.md'

# --- #575 · the response-style contract ------------------------------------
check "response-style-contract .claude/skills/response-style-contract/SKILL.md ships" \
  'test -f .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract is preloaded, never invocable" \
  'grep -q "user-invocable: false" .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract carries the four badge rows" \
  'test "$(grep -cE "^\| (🟢|🔵|🟠|🔴) \|" .claude/skills/response-style-contract/SKILL.md)" = 4'
check "response-style-contract states the badge rule, not just the palette" \
  'grep -q "A badge describes the state at the time of reading" .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract grants no tools in its frontmatter" \
  '! sed -n "2,/^---$/p" .claude/skills/response-style-contract/SKILL.md | grep -qE "^(tools|allowed-tools|permissionMode):"'
check "AGENTS.md carries the response-style managed section" \
  'grep -q "Specnaut: response-style" AGENTS.md'
check "the response-style block points at the contract rather than restating it" \
  'grep -q "response-style-contract" AGENTS.md \
   && ! grep -q "A badge describes the state at the time of reading" AGENTS.md'
check "the always-on context file carries the response-style pointer" \
  'grep -q "response-style-contract" .claude/CLAUDE.md'
check "plan-template.md ships and states WHERE questions are asked, not how" \
  'test -f .specnaut/templates/plan-template.md \
   && grep -q "Asked at the stop that ends the plan phase" .specnaut/templates/plan-template.md \
   && ! grep -qi "one at a time" .specnaut/templates/plan-template.md'
# Case-INSENSITIVE, and matching the phrase rather than one word order. The
# first version of this check was `-E "one question at a time"` with no `-i`,
# over a corpus whose only spelling is "ONE at a time" — so it grepped an empty
# file list and passed every run without reading anything.
check "the selection rule is pointed at, not restated, in the scaffolded skills" \
  '! grep -rliE "one at a time" .claude/skills/ --include="*.md" \
     | grep -v response-style-contract \
     | xargs -r grep -liE "question|ask" \
     | xargs -r grep -Li "response-style-contract" \
     | grep -q .'
check "backlog-reference-contract bans a bare number" \
  'grep -q "bare .#42. is opaque" .claude/skills/backlog-reference-contract/SKILL.md'

# --- #611 · phase addenda -------------------------------------------------
check "AGENTS.md carries the phase-addenda managed section" \
  'grep -q "Specnaut: phase-addenda" AGENTS.md'
check "the /specnaut router reads the specnaut addendum" \
  'grep -qF ".specnaut/addenda/specnaut/<verb>.md" .claude/skills/specnaut/SKILL.md'
check "the /task router reads the task addendum, audit included (spec 037)" \
  'grep -qF ".specnaut/addenda/task/<verb>.md" .claude/skills/task/SKILL.md &&
   grep -qF "\`merge\`, \`audit\`, \`constitution\`" .claude/skills/task/SKILL.md'
check "the /ship router reads the ship addendum" \
  'grep -qF ".specnaut/addenda/ship/<phase>.md" .claude/skills/ship/SKILL.md'
check "init scaffolds no addenda tree — the seam is opt-in by file" \
  'test ! -e .specnaut/addenda'

# --- the two that share nothing with each other --------------------------
check "status-audit .claude/skills/status-audit/SKILL.md reads the agent ledger" \
  'grep -q ".specnaut/logs/agents.jsonl" .claude/skills/status-audit/SKILL.md'
# cli#679: the views are computed by status-audit.sh, installed executable where the skill runs it.
check "status-audit.sh installs executable, the skill runs it, and it answers with no ledger" \
  '[ -x .specnaut/scripts/status/status-audit.sh ] &&
   grep -qF "bash .specnaut/scripts/status/status-audit.sh" .claude/skills/status-audit/SKILL.md &&
   bash .specnaut/scripts/status/status-audit.sh | grep -qF "no ledger yet"'
# alias-example was never bundled, and cli#679 removed its source too: it
# documented an `alias_of` field nothing reads. The repo-side lock is
# manifest_registration_test; this checks a project never receives it.
check "alias-example does not scaffold (retired from the repo, cli#679)" \
  '[ -d .claude/skills/task ] && [ ! -e .claude/skills/alias-example ]'

finish "CONTRACTS"
