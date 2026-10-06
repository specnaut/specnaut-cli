#!/usr/bin/env bash
# Specnaut CLI release preflight. Exit ≠ 0 ⇒ release aborts.
set -euo pipefail

# A gate must not be able to fail because its output was piped.
#
# `set -e` plus a stdout that goes away — `preflight.sh | tail`, `| head`, a
# closing terminal — turns the next `echo` into an abort, and the status it
# aborts with is indistinguishable from a real gate failure. Observed on the
# v4.2.2 attempt: a `| tail` produced `echo: write error: Interrupted system
# call` mid-report and this script announced "smoke audit is red — fix the
# findings" over an audit that had found nothing and never reached its summary.
#
# Every status line below goes through `say`, so a broken stdout costs the
# message and nothing else. The verdicts come from exit codes, which no
# consumer of this script's output can touch.
# `trap "" PIPE` and the guard are BOTH needed, and they answer different
# failures. A closed pipe raises SIGPIPE, which kills the shell outright with
# 141 before any `|| true` is consulted; ignoring the signal turns it into an
# EPIPE write error, which the guard then absorbs. The failure actually
# observed was neither — `Interrupted system call`, EINTR from a signal
# arriving mid-write — and only the guard catches that one. Measured against a
# closed consumer: signal-only exits 141, guard-only exits 141, both exit 0.
trap "" PIPE
say() { command echo "$@" 2>/dev/null || true; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

say "▶ branch check"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { say "❌ not on main (on $branch)"; exit 1; }

say "▶ working tree clean"
[ -z "$(git status --porcelain)" ] || { say "❌ working tree dirty"; git status --short; exit 1; }

say "▶ in sync with origin/main"
git fetch origin main --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { say "❌ local main diverges from origin"; exit 1; }

say "▶ open security alerts (read with your own gh credentials)"
repo="${SPECNAUT_RELEASE_REPO:-specnaut/specnaut-cli}"
# BEGIN alert-gate
# The release workflow cannot do this. Its GITHUB_TOKEN reads code scanning
# and nothing else: Dependabot alerts, secret scanning and private advisories
# are structurally out of its reach, and the only CI path is a long-lived PAT
# this public repository will never hold. So for every release up to this one
# those three sources gated nothing (#527 made the workflow say so). The
# operator's own `gh` reads all four, and this script already runs with it.
#
# Same decision tree as release.yml: an open secret-scanning alert, a critical
# (Dependabot or code scanning) or an advisory in triage blocks; high warns. A
# DRAFT advisory warns only: an accepted report sits in draft while its fix
# ships, and publishing it first would announce an unfixed hole.
#
# `hide_secret=true` keeps the leaked value out of the response — the count
# never needs it, and a debugging run without `--jq` would print it.
#
# A source that cannot be read BLOCKS. Counting it as 0 is the exact failure
# #527 was about — "could not ask" read as "clean". `count` returns non-zero
# on a gh error and on any non-numeric line; `--paginate` prints one length
# per page, which is why it sums. `read_count` is called directly, never in a
# command substitution, so the `unread` it appends to survives (#522).
count() {
  local out n total=0
  out="$(gh api --paginate "repos/$repo/$1" --jq "[.[] | $2] | length" 2>/dev/null)" || return 1
  [ -n "$out" ] || return 1
  while IFS= read -r n; do
    [[ "$n" =~ ^[0-9]+$ ]] || return 1
    total=$((total + n))
  done <<< "$out"
  printf '%s' "$total"
}
unread=""
read_count() {
  local v
  if v="$(count "$3" "$4")"; then
    printf -v "$1" '%s' "$v"
  else
    printf -v "$1" '%s' 0
    unread="$unread $2"
  fi
}
read_count secret_open secret_scanning "secret-scanning/alerts?state=open&hide_secret=true&per_page=100" '.'
read_count dep_critical dependabot "dependabot/alerts?state=open&per_page=100" 'select(.security_advisory.severity=="critical")'
read_count dep_high dependabot "dependabot/alerts?state=open&per_page=100" 'select(.security_advisory.severity=="high")'
read_count code_critical code_scanning "code-scanning/alerts?state=open&per_page=100" 'select(.rule.security_severity_level=="critical")'
read_count code_high code_scanning "code-scanning/alerts?state=open&per_page=100" 'select(.rule.security_severity_level=="high")'
# Advisories answer `[]`, not an error, to a caller without admin rights — an
# empty list that would read as clean. Trust their counts only from an admin.
read_count adv_triage private_advisories "security-advisories?state=triage&per_page=100" '.'
read_count adv_draft private_advisories "security-advisories?state=draft&per_page=100" '.'
[ "$(gh api "repos/$repo" --jq .permissions.admin 2>/dev/null || true)" = "true" ] || unread="$unread private_advisories"
unread="$(printf '%s\n' $unread | sort -u | tr '\n' ' ' | sed 's/ *$//')"

found=0
[ "$secret_open" -eq 0 ] || { say "❌ $secret_open open secret-scanning alert(s)"; found=1; }
[ $((dep_critical + code_critical)) -eq 0 ] || { say "❌ critical alerts open: $dep_critical dependabot + $code_critical code scanning"; found=1; }
[ "$adv_triage" -eq 0 ] || { say "❌ $adv_triage private advisory report(s) waiting in triage"; found=1; }
[ "$found" -eq 0 ] || say "   Resolve them in the repository's Security tab, then re-run the preflight."
# Said even when a finding already blocks: the reader must know the decision
# was taken on partial information (the lesson of #527's read-back).
[ -z "$unread" ] || { say "❌ could not read: $unread — NOT checked, which is not a clean result."; say "   gh auth status: the token needs the repo scope and admin or security-manager rights on $repo."; }
[ "$found" -eq 0 ] && [ -z "$unread" ] || exit 1
[ "$adv_draft" -eq 0 ] || say "  ! $adv_draft draft advisory(ies) — publish each once its fix is out."
[ $((dep_high + code_high)) -eq 0 ] || say "  ! high-severity alerts open: $dep_high dependabot + $code_high code scanning — the release proceeds; dispatch the security-expert agent to triage."
say "  ✓ no blocking alert: secret scanning, dependabot, code scanning, private advisories all read"
# END alert-gate

say "▶ ci and smoke green on HEAD"
sha="$(git rev-parse HEAD)"
# BEGIN workflow-gate
# Both workflows, not just `ci`: `smoke` runs the whole smoke suite
# (scripts/smoke/run-all.sh) against this exact commit, and nothing else in
# the release path asked whether it passed — a red smoke would not stop a tag.
#
# Query by commit, not by branch: `--workflow ci --branch main` was served
# from a stale index (its newest run was weeks old) while the run for HEAD
# was already green, so the loop timed out on a passing CI. `--commit` asks
# for exactly this SHA; the branch is already checked above. The headSha
# filter avoids racing on the previous commit's green run. 20 × 30s = up to
# 10 min per workflow: ci's Windows cross-smoke alone has taken longer than
# the 5 min this loop used to allow.
for wf in ci smoke; do
  conclusion=""
  for i in $(seq 1 20); do
    conclusion="$(gh run list --workflow "$wf" --commit "$sha" --limit 20 --json headSha,conclusion,status --jq "[.[] | select(.headSha == \"$sha\" and .status == \"completed\")] | .[0].conclusion")"
    [ -n "$conclusion" ] && [ "$conclusion" != "null" ] && break
    say "  waiting for the $wf run on $sha to complete ($i/20)…"
    sleep 30
  done
  [ "$conclusion" = "success" ] || { say "❌ $wf not green on $sha (got: ${conclusion:-no-completed-run-after-10min})"; exit 1; }
  say "  ✓ $wf green"
done
# END workflow-gate

say "▶ smoke audit"
# The audit owns its own verdict: its exit code IS the answer (plan.md §5 R5).
# This caller must not re-derive it by parsing the report.
# Branch on WHICH non-zero. `if ! …` treated every failure as a coverage
# verdict, so a tagless or shallow clone — audit.sh exits 2 when it cannot
# resolve a baseline — aborted the release under "fix the findings", advice
# for a condition that had not occurred. Wrong diagnosis at the worst moment.
#
# The audit writes to a FILE and the report is replayed afterwards. It runs
# under `set -e` too, so a failed write to a shared stdout aborts it mid-report
# — with exit 1, the same code a real coverage gap uses. Handing it a regular
# file is what keeps its exit code meaning what this `case` reads it as.
audit_log="$(mktemp "${TMPDIR:-/tmp}/specnaut-audit.XXXXXX")"
audit_rc=0
bash scripts/smoke/audit.sh > "$audit_log" 2>&1 || audit_rc=$?
cat "$audit_log" 2>/dev/null || true
rm -f "$audit_log"
case "$audit_rc" in
  0) ;;
  1)
    say "❌ smoke audit is red — fix the findings, or allow-list a coverage gap"
    say "   with a written reason in scripts/smoke/coverage-allowlist.txt."
    exit 1
    ;;
  *)
    say "❌ smoke audit could not RUN (exit $audit_rc) — this is not a findings"
    say "   verdict. 2 = no v*.*.* tag or unresolvable baseline (a shallow or"
    say "   tagless clone); 3 = --src-root is not a git work tree."
    exit 1
    ;;
esac

say "▶ deno task bundle (re-sync)"
deno task bundle
[ -z "$(git status --porcelain src/templates_bundle.ts)" ] || { say "❌ bundle drifted — commit the regenerated src/templates_bundle.ts first"; exit 1; }

say "▶ deno task test"
deno task test

say "✅ preflight passed"
