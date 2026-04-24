#!/bin/bash
set -euo pipefail

ACTION="${1:-unknown}"
LOG_DIR=".claude/logs"
RAW_DIR="${LOG_DIR}/raw"
LOG_FILE="${LOG_DIR}/agent-events.jsonl"
STATUS_FILE="${LOG_DIR}/agent-status.json"

mkdir -p "$LOG_DIR" "$RAW_DIR"

INPUT="$(cat)"

if ! printf '%s' "$INPUT" | jq -e . >/dev/null 2>&1; then
  INPUT='{}'
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

RAW_TEXT="$(printf '%s' "$INPUT" | tr '\n' ' ' | tr -s ' ')"

extract_label() {
  local label="$1"
  printf '%s' "$RAW_TEXT" \
    | sed -nE "s/.*${label}[[:space:]]*:[[:space:]]*([^[:cntrl:]]+).*/\1/p" \
    | sed -E 's/[[:space:]]+$//' \
    | head -n 1
}

AGENT_NAME="$(printf '%s' "$INPUT" | jq -r '.subagent.name // .agent.name // .agentName // .subagent_name // .tool_input.agent_name // .tool_input.agent // .agent // "unknown"')"
EVENT_NAME="$(printf '%s' "$INPUT" | jq -r '.event_name // .eventName // empty')"
FEATURE_SPEC="$(printf '%s' "$RAW_TEXT" | grep -oE 'specs/[0-9]{3}-[A-Za-z0-9._-]+' | head -n 1 | sed 's#^specs/##')"
STATE="$(extract_label 'STATE')"
DONE_CRITERIA_MET="$(extract_label 'DONE_CRITERIA_MET')"
SUMMARY="$(extract_label 'SUMMARY')"
ARTIFACTS="$(extract_label 'ARTIFACTS')"
FILES_CHANGED="$(extract_label 'FILES_CHANGED')"
VALIDATION="$(extract_label 'VALIDATION')"
BLOCKERS="$(extract_label 'BLOCKERS')"
NEXT_ACTION="$(extract_label 'NEXT_ACTION')"
HANDOFF_TARGET="$(extract_label 'HANDOFF_TARGET')"
REVIEW_SCOPE="$(extract_label 'REVIEW_SCOPE')"
REVIEW_VERDICT="$(extract_label 'REVIEW_VERDICT')"
CRITICAL_COUNT="$(extract_label 'CRITICAL_COUNT')"
HIGH_COUNT="$(extract_label 'HIGH_COUNT')"
MEDIUM_COUNT="$(extract_label 'MEDIUM_COUNT')"
LOW_COUNT="$(extract_label 'LOW_COUNT')"
TOP_ISSUES="$(extract_label 'TOP_ISSUES')"
REVIEW_RECOMMENDATION="$(extract_label 'RECOMMENDATION')"
QA_SCOPE="$(extract_label 'QA_SCOPE')"
QA_VERDICT="$(extract_label 'QA_VERDICT')"
NEW_UNIT_TESTS="$(extract_label 'NEW_UNIT_TESTS')"
NEW_FUNCTIONAL_TESTS="$(extract_label 'NEW_FUNCTIONAL_TESTS')"
NEW_BROWSER_TESTS="$(extract_label 'NEW_BROWSER_TESTS')"
TOTAL_PASS_COUNT="$(extract_label 'TOTAL_PASS_COUNT')"
TOTAL_FAIL_COUNT="$(extract_label 'TOTAL_FAIL_COUNT')"
BUGS_FOUND="$(extract_label 'BUGS_FOUND')"
QA_RECOMMENDATION="$(extract_label 'QA_RECOMMENDATION')"

if [ -z "$STATE" ]; then
  if [ "$ACTION" = 'start' ]; then
    STATE='in_progress'
  elif [ "$ACTION" = 'stop' ]; then
    STATE='done'
  else
    STATE='unknown'
  fi
fi

if [ -z "$DONE_CRITERIA_MET" ]; then
  if [ "$STATE" = 'done' ]; then
    DONE_CRITERIA_MET='yes'
  else
    DONE_CRITERIA_MET='no'
  fi
fi

RAW_FILE="${RAW_DIR}/${TIMESTAMP//:/-}-${AGENT_NAME}-${ACTION}.json"
printf '%s\n' "$INPUT" > "$RAW_FILE"

EVENT_JSON="$(jq -n \
  --arg timestamp "$TIMESTAMP" \
  --arg action "$ACTION" \
  --arg event_name "$EVENT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg agent "$AGENT_NAME" \
  --arg state "$STATE" \
  --arg done_criteria_met "$DONE_CRITERIA_MET" \
  --arg summary "$SUMMARY" \
  --arg artifacts "$ARTIFACTS" \
  --arg files_changed "$FILES_CHANGED" \
  --arg validation "$VALIDATION" \
  --arg blockers "$BLOCKERS" \
  --arg next_action "$NEXT_ACTION" \
  --arg handoff_target "$HANDOFF_TARGET" \
  --arg review_scope "$REVIEW_SCOPE" \
  --arg review_verdict "$REVIEW_VERDICT" \
  --arg critical_count "$CRITICAL_COUNT" \
  --arg high_count "$HIGH_COUNT" \
  --arg medium_count "$MEDIUM_COUNT" \
  --arg low_count "$LOW_COUNT" \
  --arg top_issues "$TOP_ISSUES" \
  --arg review_recommendation "$REVIEW_RECOMMENDATION" \
  --arg qa_scope "$QA_SCOPE" \
  --arg qa_verdict "$QA_VERDICT" \
  --arg new_unit_tests "$NEW_UNIT_TESTS" \
  --arg new_functional_tests "$NEW_FUNCTIONAL_TESTS" \
  --arg new_browser_tests "$NEW_BROWSER_TESTS" \
  --arg total_pass_count "$TOTAL_PASS_COUNT" \
  --arg total_fail_count "$TOTAL_FAIL_COUNT" \
  --arg bugs_found "$BUGS_FOUND" \
  --arg qa_recommendation "$QA_RECOMMENDATION" \
  --arg feature_spec "$FEATURE_SPEC" \
  --arg raw_file "$RAW_FILE" \
  '{
    timestamp: $timestamp,
    action: $action,
    event_name: $event_name,
    session_id: $session_id,
    agent: $agent,
    state: $state,
    done_criteria_met: $done_criteria_met,
    summary: $summary,
    artifacts: $artifacts,
    files_changed: $files_changed,
    validation: $validation,
    blockers: $blockers,
    next_action: $next_action,
    handoff_target: $handoff_target,
    review_scope: $review_scope,
    review_verdict: $review_verdict,
    critical_count: $critical_count,
    high_count: $high_count,
    medium_count: $medium_count,
    low_count: $low_count,
    top_issues: $top_issues,
    review_recommendation: $review_recommendation,
    qa_scope: $qa_scope,
    qa_verdict: $qa_verdict,
    new_unit_tests: $new_unit_tests,
    new_functional_tests: $new_functional_tests,
    new_browser_tests: $new_browser_tests,
    total_pass_count: $total_pass_count,
    total_fail_count: $total_fail_count,
    bugs_found: $bugs_found,
    qa_recommendation: $qa_recommendation,
    feature_spec: $feature_spec,
    raw_file: $raw_file
  }')"

printf '%s\n' "$EVENT_JSON" >> "$LOG_FILE"

if [ ! -f "$STATUS_FILE" ]; then
  printf '{}\n' > "$STATUS_FILE"
fi

TMP_FILE="$(mktemp)"
jq \
  --arg agent "$AGENT_NAME" \
  --arg timestamp "$TIMESTAMP" \
  --arg action "$ACTION" \
  --arg session_id "$SESSION_ID" \
  --arg state "$STATE" \
  --arg done_criteria_met "$DONE_CRITERIA_MET" \
  --arg summary "$SUMMARY" \
  --arg artifacts "$ARTIFACTS" \
  --arg files_changed "$FILES_CHANGED" \
  --arg validation "$VALIDATION" \
  --arg blockers "$BLOCKERS" \
  --arg next_action "$NEXT_ACTION" \
  --arg handoff_target "$HANDOFF_TARGET" \
  --arg review_scope "$REVIEW_SCOPE" \
  --arg review_verdict "$REVIEW_VERDICT" \
  --arg critical_count "$CRITICAL_COUNT" \
  --arg high_count "$HIGH_COUNT" \
  --arg medium_count "$MEDIUM_COUNT" \
  --arg low_count "$LOW_COUNT" \
  --arg top_issues "$TOP_ISSUES" \
  --arg review_recommendation "$REVIEW_RECOMMENDATION" \
  --arg qa_scope "$QA_SCOPE" \
  --arg qa_verdict "$QA_VERDICT" \
  --arg new_unit_tests "$NEW_UNIT_TESTS" \
  --arg new_functional_tests "$NEW_FUNCTIONAL_TESTS" \
  --arg new_browser_tests "$NEW_BROWSER_TESTS" \
  --arg total_pass_count "$TOTAL_PASS_COUNT" \
  --arg total_fail_count "$TOTAL_FAIL_COUNT" \
  --arg bugs_found "$BUGS_FOUND" \
  --arg qa_recommendation "$QA_RECOMMENDATION" \
  --arg feature_spec "$FEATURE_SPEC" \
  --arg raw_file "$RAW_FILE" \
  '.[$agent] = {
    agent: $agent,
    last_update: $timestamp,
    last_event: $action,
    session_id: $session_id,
    state: $state,
    done_criteria_met: $done_criteria_met,
    summary: $summary,
    artifacts: $artifacts,
    files_changed: $files_changed,
    validation: $validation,
    blockers: $blockers,
    next_action: $next_action,
    handoff_target: $handoff_target,
    review_scope: $review_scope,
    review_verdict: $review_verdict,
    critical_count: $critical_count,
    high_count: $high_count,
    medium_count: $medium_count,
    low_count: $low_count,
    top_issues: $top_issues,
    review_recommendation: $review_recommendation,
    qa_scope: $qa_scope,
    qa_verdict: $qa_verdict,
    new_unit_tests: $new_unit_tests,
    new_functional_tests: $new_functional_tests,
    new_browser_tests: $new_browser_tests,
    total_pass_count: $total_pass_count,
    total_fail_count: $total_fail_count,
    bugs_found: $bugs_found,
    qa_recommendation: $qa_recommendation,
    feature_spec: $feature_spec,
    raw_file: $raw_file
  }' \
  "$STATUS_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$STATUS_FILE"