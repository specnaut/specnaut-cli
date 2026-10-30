#!/usr/bin/env bash
# The seven session-health views over the status ledger, computed — not derived
# by a model reading the file (cli#679).
#
#   status-audit.sh [latest|<agent>|<session>]
#
# Reads `.specnaut/logs/agents.jsonl` from the current directory (the project
# root) and prints a report. Writes nothing. The ledger schema and its enums are
# in `.specnaut/logs/README.md`; `log-subagent.sh` writes it.
#
# The fields are SUBAGENT OUTPUT, and the report is read back by a model, so the
# program below treats every one as data (plan 044 § 11):
#   - each line is parsed with `fromjson?`; one that is not a JSON object is
#     counted, never printed;
#   - no field reaches a jq filter, an eval or a shell — the scope argument goes
#     in through `--arg`, and is checked against the id charset first;
#   - event / state / done_criteria_met / verdicts are checked against their
#     enums, agent / session / handoff_target against `^[A-Za-z0-9:_.-]{1,64}$`,
#     ts against ISO-8601; anything else prints as `invalid` and is counted;
#   - every printed value is stripped of C0/C1 controls, U+2028/U+2029, the
#     bidi overrides U+202A–U+202E / U+2066–U+2069 and the invisible marks
#     (LRM/RLM, ALM, zero-width, U+FEFF, tags), and capped at 64 characters.
#
# Exit codes:
#   0  the report — or "no ledger yet", which is not an error
#   2  usage: more than one argument, or one outside the id charset
#   3  could not answer: jq is missing, the ledger is unreadable, or jq failed
set -u

LEDGER=".specnaut/logs/agents.jsonl"
NO_LEDGER="no ledger yet — no subagents have run in this project, or the \`log-subagent.sh\` hook is not wired."
USAGE="usage: status-audit.sh [latest|<agent>|<session>]"

if [ "$#" -gt 1 ]; then
  printf '%s\n' "$USAGE" >&2
  exit 2
fi
SCOPE="${1:-latest}"
case "$SCOPE" in
  -h | --help)
    printf '%s\n' "$USAGE"
    exit 0
    ;;
esac
id_re='^[A-Za-z0-9:_.-]{1,64}$'
if ! [[ "$SCOPE" =~ $id_re ]]; then
  printf '%s\n' "$USAGE" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  printf 'status-audit: jq is required and was not found on PATH — no report.\n' >&2
  exit 3
fi
if [ ! -e "$LEDGER" ]; then
  printf '%s\n' "$NO_LEDGER"
  exit 0
fi
if [ -d "$LEDGER" ] || [ ! -r "$LEDGER" ]; then
  printf 'status-audit: cannot read %s — no report.\n' "$LEDGER" >&2
  exit 3
fi

# `read -d ''` returns 1 at the end of the heredoc; the program is still read.
read -r -d '' PROGRAM <<'JQ' || true
def STATES: ["in_progress","blocked","awaiting_review","awaiting_qa","awaiting_user","done","failed"];

# Printable only, and bounded: drop C0 (and DEL), C1, U+2028/U+2029, the
# bidi overrides and isolates, and every mark a model reads but a terminal
# does not show (cli#713) — ALM U+061C, U+200B–U+200F (zero-width space,
# non-joiner and joiner, LRM, RLM), U+2060–U+2064 (word joiner, invisible
# operators), U+FEFF and the tag block U+E0000–U+E007F; then cap at 64.
def clean:
  tostring | explode
  | map(select((. >= 32 and . < 127)
      or (. > 159 and . != 1564 and (. < 8203 or . > 8207)
          and . != 8232 and . != 8233 and (. < 8234 or . > 8238)
          and (. < 8288 or . > 8292) and (. < 8294 or . > 8297)
          and . != 65279 and (. < 917504 or . > 917631))))
  | .[:64] | implode;

def enumv($allowed):
  if . == null then "unknown"
  elif type == "string" and (. as $v | any($allowed[]; . == $v)) then .
  else "invalid" end;
def idv:
  if . == null then "unknown"
  elif type == "string" and test("\\A[A-Za-z0-9:_.-]{1,64}\\z") then .
  else "invalid" end;
def tsv:
  if . == null then "unknown"
  elif type == "string"
    and test("\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z\\z") then .
  else "invalid" end;

def norm($i):
  { i: $i,
    ts: (.ts | tsv),
    event: (.event | enumv(["start","stop"])),
    session: (.session | idv),
    agent: (.agent | idv),
    state: (.state | enumv(STATES)),
    done: (.done_criteria_met | enumv(["yes","no"])),
    handoff: (.handoff_target | idv),
    review: (.review_verdict | enumv(["pass","fail","needs_followup"])),
    qa: (.qa_verdict | enumv(["pass","fail","blocked"])) }
  # An entry with no valid ts sorts first, so it is never "latest" by accident.
  | .key = (if .ts == "unknown" or .ts == "invalid" then "" else .ts end);

def epoch: try (sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) catch null;
def later($a; $b): ($a.key > $b.key) or ($a.key == $b.key and $a.i > $b.i);
def rows(f): if length == 0 then "  none" else map(f) | join("\n") end;
def counts($names; f): [$names[] as $n | "\($n) \(map(select(f == $n)) | length)"] | join(", ");
def withinvalid(f): (map(select(f == "invalid")) | length) as $n
  | if $n > 0 then ", invalid \($n)" else "" end;

[inputs | sub("\r$"; "")] | map(select(test("\\S"))) as $raw
| if ($raw | length) == 0 then $nomsg
  else
    [$raw | to_entries[] | (.key) as $i | [.value | fromjson?]
      | if length == 1 and (.[0] | type) == "object" then (.[0] | norm($i)) else empty end] as $all
    | (($raw | length) - ($all | length)) as $skipped
    | ([$all[] | (.ts, .event, .session, .agent, .state, .done, .handoff, .review, .qa)
        | select(. == "invalid")] | length) as $invalid
    | (if $scope == "latest" then {label: "latest (whole ledger)", e: $all}
       elif any($all[]; .agent == $scope) then
         {label: "agent \($scope)", e: [$all[] | select(.agent == $scope)]}
       elif any($all[]; .session == $scope) then
         {label: "session \($scope)", e: [$all[] | select(.session == $scope)]}
       else {label: "\($scope): no entry matches", e: []} end) as $sc
    | ($sc.e | group_by(.agent) | map(sort_by(.key, .i) | last)) as $latest
    | now as $now
    | [ "STATUS AUDIT — \($sc.label | clean)",
        "ledger: .specnaut/logs/agents.jsonl · \($sc.e | length) entries · \($latest | length) agent(s) in scope",
        (if $skipped > 0 then "skipped \($skipped) malformed line(s)" else empty end),
        (if $invalid > 0 then "\($invalid) invalid field value(s), shown as invalid" else empty end),
        "",
        "1. Health",
        ([(STATES + ["unknown","invalid"])[] as $s
          | ($latest | map(select(.state == $s)) | length) as $n
          | select($n > 0) | "\($s): \($n)"]
         | if length == 0 then "  none" else "  " + join(", ") end),
        "2. Per-agent",
        ($latest | rows("  \(.agent | clean) · state \(.state | clean) · review \(.review | clean) · qa \(.qa | clean) · last update \(.ts | clean)")),
        "3. Blocked",
        ($latest | map(select(.state == "blocked"))
         | rows("  URGENT \(.agent | clean) · blocked since \(.ts | clean) · session \(.session | clean)")),
        "4. Stale (non-terminal, no entry for 15 minutes or more)",
        ($latest | map(select(.state != "done" and .state != "failed")
            | . + {age: (.key | if . == "" then null else epoch end)}
            | select(.age != null and ($now - .age) >= 900))
         | rows("  \(.agent | clean) · \(.state | clean) · no entry for \((($now - .age) / 60) | floor) min (last \(.ts | clean))")),
        "5. Contradictions (state done, done_criteria_met no)",
        ($latest | map(select(.state == "done" and .done == "no"))
         | rows("  \(.agent | clean) · state done but done_criteria_met no · \(.ts | clean)")),
        "6. Missing handoffs",
        ($latest | map(select(.handoff != "none" and .handoff != "unknown" and .handoff != "invalid")
            | . as $h
            | select(any($all[]; .agent == $h.handoff and .session == $h.session and later(.; $h)) | not))
         | rows("  \(.agent | clean) → \(.handoff | clean) · session \(.session | clean) · no later entry for \(.handoff | clean)")),
        "7. Verdict summary",
        ($sc.e | "  review_verdict: \(counts(["pass","fail","needs_followup"]; .review))\(withinvalid(.review))"),
        ($sc.e | "  qa_verdict: \(counts(["pass","fail","blocked"]; .qa))\(withinvalid(.qa))")
      ] | join("\n")
  end
JQ

if ! out="$(jq -rRn --arg scope "$SCOPE" --arg nomsg "$NO_LEDGER" "$PROGRAM" "$LEDGER")"; then
  printf 'status-audit: jq could not read %s — no report.\n' "$LEDGER" >&2
  exit 3
fi
# A native Windows jq.exe ends each line in CRLF.
printf '%s\n' "${out//$'\r'/}"
