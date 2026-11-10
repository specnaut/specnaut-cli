#!/usr/bin/env bash
# The release security gate: the `security-preflight` job of release.yml runs
# this file, and tests/scripts/security_preflight_degraded_test.ts runs it
# against a stubbed `gh`. Needs GH_TOKEN and REPO; writes GITHUB_STEP_SUMMARY.
#
# WHAT THIS JOB CAN ACTUALLY SEE, measured on the v3.2.0 run once #522 made
# the degraded warning printable for the first time:
#
#   code scanning        ✓ readable via `security-events: read`
#   secret scanning      ✗ needs repo-admin / security-manager rights
#   dependabot alerts    ✗ GITHUB_TOKEN cannot read them, at any severity
#   private advisories   ✗ `repository-advisories` is a fine-grained PAT
#                          scope, not a workflow permissions key — adding it
#                          here fails the workflow parse outright
#
# Three of the four are structural, not a missing line in this block. The
# comment here used to attribute secret scanning to `security-events` and
# dependabot to `contents`; both were wrong, and nothing contradicted them
# because the warning that would have was dead code.
#
# The step no longer reports an unreadable source as `0`. A count it could
# not obtain is excluded from the gate decision and named in the summary —
# so a release that passes says which signals it actually checked (#527).
#
# The three structural gaps are gated LOCALLY instead (#653): the release
# preflight (`.specnaut/release/preflight.sh`) reads secret scanning,
# Dependabot and private advisories with the operator's own `gh`, before the
# tag exists, and blocks on an unreadable source. No PAT: this public
# repository holds no Actions secrets. So their cells here say where they
# are gated, and the warning names only a source that SHOULD be readable —
# a line printed on every release is a line nobody reads.

set -euo pipefail

# `gh api` writes 4xx error JSON to STDOUT (not stderr), so a naive
# `2>/dev/null || echo 0` lets non-numeric blobs leak into shell
# arithmetic and crashes the job (line "$((dep_critical + ...))"
# fails with "syntax error: operand expected"). Wrap every count
# through a coercer that rejects anything that isn't pure digits.
# Permission gaps surface as 0 here and downstream — a degraded
# but non-blocking signal — and a workflow ::warning is emitted
# so the local /release session can investigate.
#
# The degraded labels go to a FILE, not an array (#522). Every call
# site below is a command substitution, so `fetch_count` runs in a
# subshell and any `missing_perms+=()` died with it: the parent's
# array was always empty and the warning at the bottom of this step
# had never once printed. Not a latent path either — three of the
# sources were unreadable on every run, so the step had been in
# degraded mode permanently and silently. A revoked scope on any
# query reads as "0 open alerts", and the gate then passes on an
# empty signal it believes is a clean one.
degraded_file="${RUNNER_TEMP:-/tmp}/security-preflight-degraded.txt"
: > "$degraded_file"
fetch_count() {
  local label="$1" url="$2" jq_filter="$3"
  local out
  out=$(gh api "$url" --jq "$jq_filter" 2>/dev/null || true)
  if [[ "$out" =~ ^[0-9]+$ ]]; then
    printf '%s' "$out"
  else
    # Appending from a subshell is fine; the parent reads the file.
    printf '%s\n' "$label" >> "$degraded_file"
    printf '0'
  fi
}

# 1. Secret scanning — pattern-based credential leak detection
secret_open=$(fetch_count "secret_scanning" \
  "repos/$REPO/secret-scanning/alerts?state=open&hide_secret=true&per_page=100" \
  '[.[] | {number, secret_type_display_name, html_url}] | length')

# 2. Dependabot — vulnerable dependencies (severity-aware)
dep_critical=$(fetch_count "dependabot/critical" \
  "repos/$REPO/dependabot/alerts?state=open&per_page=100" \
  '[.[] | select(.security_advisory.severity=="critical")] | length')
dep_high=$(fetch_count "dependabot/high" \
  "repos/$REPO/dependabot/alerts?state=open&per_page=100" \
  '[.[] | select(.security_advisory.severity=="high")] | length')
dep_medium=$(fetch_count "dependabot/medium" \
  "repos/$REPO/dependabot/alerts?state=open&per_page=100" \
  '[.[] | select(.security_advisory.severity=="medium")] | length')

# 3. Private vulnerability reports are NOT queried here. The
# `repository-advisories` scope is a fine-grained PAT's, and a caller
# without it can be answered `[]` — an empty list that reads as clean
# rather than an error. The local preflight gates them (#653).

# 4. Code scanning (CodeQL — only counts when code scanning is enabled).
code_critical=$(fetch_count "code_scanning/critical" \
  "repos/$REPO/code-scanning/alerts?state=open&per_page=100" \
  '[.[] | select(.rule.security_severity_level=="critical")] | length')
code_high=$(fetch_count "code_scanning/high" \
  "repos/$REPO/code-scanning/alerts?state=open&per_page=100" \
  '[.[] | select(.rule.security_severity_level=="high")] | length')

# Decision tree:
#   ANY critical (dep or code) → fail the release.
#   Secret-scanning open       → fail (every match is treated as P0
#                                regardless of "severity" — credentials
#                                in source are always release-blocking).
#   Pending advisory in triage → fail — enforced by the local
#                                preflight, which can read them (#653).
critical_total=$((dep_critical + code_critical))

# Report what was READ, not what was assumed. A source `fetch_count`
# could not reach yields 0, and 0 is indistinguishable from "clean" —
# which is how this gate passed every release on three sources it had
# never once obtained (#527). `unreadable` is the honest cell.
readable() { ! grep -qxF "$1" "$degraded_file"; }
# GITHUB_TOKEN cannot read these by design; the local preflight gates
# them. Unreadable HERE is expected, and is not what the warning is for.
gated_locally() { case "$1" in secret_scanning | dependabot/*) return 0 ;; esac; return 1; }
cell() {
  if readable "$1"; then printf '%s' "$2"
  elif gated_locally "$1"; then printf 'not read here — gated by `preflight.sh`'
  else printf 'unreadable'; fi
}
unexpected="$(sort -u "$degraded_file" | while IFS= read -r l; do gated_locally "$l" || printf '%s\n' "$l"; done)"

{
  echo "## Security alert preflight"
  echo
  echo "| Source | Open count |"
  echo "| --- | --- |"
  echo "| Secret scanning | $(cell secret_scanning "$secret_open") |"
  echo "| Dependabot — critical | $(cell dependabot/critical "$dep_critical") |"
  echo "| Dependabot — high | $(cell dependabot/high "$dep_high") |"
  echo "| Dependabot — medium | $(cell dependabot/medium "$dep_medium") |"
  echo "| Code scanning — critical | $(cell code_scanning/critical "$code_critical") |"
  echo "| Code scanning — high | $(cell code_scanning/high "$code_high") |"
  echo "| Pending private advisories | not read here — gated by \`preflight.sh\` |"
  echo
  echo "Critical total (dep + code, readable sources only): **${critical_total}**"
  if [ -n "$unexpected" ]; then
    echo
    echo "> Sources marked \`unreadable\` were NOT checked. This preflight"
    echo "> passing means the readable ones are clean — nothing more."
  fi
} >> "$GITHUB_STEP_SUMMARY"

# Said BEFORE the decision, not after. The read-back used to sit below
# the hard-fail `exit 1`, so the single run where it matters most —
# the gate blocking on partial information — was the one run that
# never printed it (#527).
#
# Sorted and de-duplicated: the three dependabot queries share a URL,
# so one permission gap would otherwise name it three times.
if [ -n "$unexpected" ]; then
  missing_perms="$(printf '%s\n' "$unexpected" | tr '\n' ' ' | sed 's/ $//')"
  echo "::warning::Security preflight could not read: ${missing_perms}. Those sources are NOT checked and are excluded from the decision below — a pass here means the readable sources are clean, not that the repository is. This job's token is expected to read them: check its permissions block (#527)."
fi

if [ "$critical_total" -gt 0 ] || [ "$secret_open" -gt 0 ]; then
  echo "::error::Security preflight blocked the release. Critical/secret counts are non-zero. Resolve via the Security tab, then re-run this workflow (the tag stays valid)."
  exit 1
fi

if [ "$dep_high" -gt 0 ] || [ "$code_high" -gt 0 ]; then
  echo "::warning::High-severity findings open: $dep_high dependabot + $code_high code-scanning. The release proceeds; triage them in the Security tab."
fi
