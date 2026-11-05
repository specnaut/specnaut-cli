#!/usr/bin/env bash
# A report to Specnaut's public tracker, from someone else's project (cli#726).
# What only a machine can promise lives here: the bytes the user approved are the
# bytes sent, what looks like a secret does not leave, upstream text reaches the
# agent sanitised. The flow, and what counts as a yes, is the `/specnaut issue`
# phase; this script checks no yes. Coordinates are constants: project files are
# read only to refuse their values, never to address anything. No board is named.
#
# Usage:
#   report-upstream.sh probe
#   report-upstream.sh search [--accept-literals]                 < terms
#   report-upstream.sh prepare --kind bug|proposal [--accept-literals]  < report
#   report-upstream.sh create <digest>
#   report-upstream.sh link <digest>
# A report on stdin is its title on the first line, then its body.
#
# Stdout is a closed grammar; every line is one of these:
#   POSTING_AS <login>
#   DIGEST <hex>
#   FILE <path>
#   MATCH <n> open|closed <url>
#   TITLE <n> <sanitised>
#   REFUSED <class>
#   REFUSED literal home|hostname|directory|git-user|remote|backlog-repo
#   CREATED <url>|unverified
#   ISSUE ok|unreadable
#   LABEL <name> set|skipped
#   LINK <url>|too-long
# POSTING_AS - means gh has no identity to post as. A MATCH or CREATED url is an
# issue of the pinned repository, or it is not printed. gh's stderr is discarded;
# this script's own stderr is the fixed usage line.
#
# Refused classes, each printed alone and never with the value that caused it:
#   secret      no override. GitHub and GitLab tokens, sk-ant-, sk-, sk_test_, AKIA,
#               ASIA, sk_live, rk_live, xox?-, xapp-, npm_, pypi-, hf_, AIza, ya29.,
#               SG., whsec_, shpat_, dop_v1_, dckr_pat_, JWTs, -----BEGIN,
#               scheme://user:pass@; a password, secret, token, API or access key,
#               client secret or credential assigned a value of 8 or more; Bearer or
#               Basic with a token-like value; Authorization, Cookie and X-Api-Key
#               headers; the value of any set environment variable whose name holds
#               TOKEN, KEY, SECRET, PASS, CRED or DSN
#   hidden      no override. Control characters, ANSI, zero-width, bidi, tag,
#               variation (not U+FE0F), interlinear and filler characters, HTML
#               comments, Markdown reference definitions
#   literal     --accept-literals, once the user was told; it prints its kind.
#               $HOME and $USER, hostname, every segment of the directory and the
#               toplevel below $HOME (the last alone elsewhere), the host and every
#               path segment of each remote, git config user.*, and repo, host,
#               project_id, project_key, api_url of backlog-config.yml; whole word,
#               `_` counting as a space, minus a short stoplist
#   addressing  emails, home paths (~/, /Users, /home, /srv, /workspaces, /builds, a
#               drive letter), URLs outside the allowlist or with a second scheme,
#               hosts with no scheme ending .internal .local .corp .lan .com .net
#               .org .io .dev .cloud, RFC 1918 addresses, @mentions and @scopes,
#               owner/repo#N, a bare #N the last search did not return
#   digest      not the bytes prepared: another digest, an edit, a symlink
#   identity    gh now posts as another login than the report was prepared for
#   storage     ~/.specnaut cannot be used: not writable, or a symlink
#   repository  gh reached a repository whose numeric id is not the constant
#   gh          no gh, or no read through it
#   empty       a report or search with nothing in it
#   size        over 60000 bytes, or a title over 256
# A scan that could not run refuses as its class.
#
# Exit: 0 done, 2 usage, 3 REFUSED, 5 CREATED unverified, 6 ISSUE unreadable.
# A failure after creation is never a second create: <digest>.sent records the
# attempt, and only a new `prepare` of those bytes, a new ask, clears an empty one.
# `prepare` deletes unsent reports older than a day.
set -uf -o pipefail
export LC_ALL=C
export GH_HOST=github.com GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 NO_COLOR=1 GH_PAGER=cat
# Git Bash rewrites an argument shaped like a path; a title may start with `/task`.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
unset GH_REPO GH_DEBUG GH_FORCE_TTY CLICOLOR_FORCE
umask 077

REPO=specnaut/specnaut-cli
REPO_ID=1218483524
PROVENANCE=from:specnaut-guide
ISSUE_URL_RE='^https://github\.com/specnaut/specnaut-cli/issues/[0-9]+$'
DIGEST_RE='^[0-9a-f]{64}$'
LOGIN_RE='^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$'
MAX_BYTES=60000
MAX_LINK=3000

here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
usage() { echo "usage: report-upstream.sh probe|search|prepare|create|link" >&2; exit 2; }
refuse() { echo "REFUSED $1"; exit 3; }
[ -n "${HOME:-}" ] || usage
# shellcheck source-path=SCRIPTDIR source=_report_text.sh
. "$here/_report_text.sh" || usage
# shellcheck source-path=SCRIPTDIR source=_report_store.sh
. "$here/_report_store.sh" || usage

have_gh() { command -v gh >/dev/null 2>&1; }

posting_as() {
  local login=
  have_gh && login=$(gh api user --jq .login 2>/dev/null)
  login=${login%"$CR"}
  if [[ $login =~ $LOGIN_RE ]]; then echo "$login"; else echo -; fi
}

# Sets REPO_READ_ID, CAN_PUSH, CAN_TRIAGE: one read, before anything is created.
read_repository() {
  local out
  have_gh || refuse gh
  out=$(gh api "repos/$REPO" --jq '"\(.id) \(.permissions.push) \(.permissions.triage)"' 2>/dev/null) || refuse gh
  read -r REPO_READ_ID CAN_PUSH CAN_TRIAGE <<<"${out%"$CR"}"
  [ "$REPO_READ_ID" = "$REPO_ID" ] || refuse repository
}

cmd_probe() {
  local login
  read_repository
  login=$(posting_as)
  [ "$login" != - ] || refuse gh
  echo "POSTING_AS $login"
}

print_search_link() {
  printf 'LINK https://github.com/%s/issues?q=%s\n' "$REPO" "$(printf '%s' "${TERMS[*]}" | url_encode)"
}

# A qualifier could aim the search elsewhere (`repo:`, `author:`): any `:` drops the token.
collect_terms() {
  local w
  TERMS=()
  for w in $1; do
    case $w in *:*) continue ;; esac
    [ "${#TERMS[@]}" -lt 8 ] || break
    TERMS[${#TERMS[@]}]=$w
  done
  [ "${#TERMS[@]}" -gt 0 ] || refuse empty
}

# Prints each record that holds up, and remembers its number for the bare #N rule.
record_matches() {
  local num state url title lines="" numbers=""
  while IFS=$'\t' read -r num state url title; do
    url=${url%"$CR"}
    [[ $num =~ ^[1-9][0-9]*$ ]] && [[ $url =~ $ISSUE_URL_RE ]] && [ "${url##*/}" = "$num" ] || continue
    case $state in open | OPEN) state=open ;; closed | CLOSED) state=closed ;; *) continue ;; esac
    numbers="$numbers$num$NL"
    lines="${lines}MATCH $num $state $url${NL}TITLE $num $(sanitise_title "${title%"$CR"}")$NL"
  done <<<"$1"
  write_file "$DIR/matches" "$numbers"
  printf '%s' "$lines"
}

cmd_search() {
  local accept=0 out
  [ "${1:-}" = --accept-literals ] && { accept=1; shift; }
  [ $# -eq 0 ] || usage
  use_report_dir
  read_input
  scan_all "$RAW" "$accept"
  collect_terms "$RAW"
  have_gh || { print_search_link; return 0; }
  out=$(gh search issues --repo "$REPO" --limit 10 --json number,state,url,title \
    --jq '.[] | [.number, .state, .url, .title] | @tsv' -- "${TERMS[@]}" 2>/dev/null) || {
    print_search_link
    return 0
  }
  record_matches "$out"
}

cmd_prepare() {
  local kind="" accept=0 text digest login
  while [ $# -gt 0 ]; do
    case $1 in
      --kind) [ $# -ge 2 ] || usage; kind=$2; shift 2 ;;
      --accept-literals) accept=1; shift ;;
      *) usage ;;
    esac
  done
  case $kind in bug | proposal) ;; *) usage ;; esac
  use_report_dir
  read_input
  scan_all "$RAW" "$accept"
  split_report
  text="kind: $kind${NL}title: $TITLE$NL$NL$BODY"
  digest=$(digest_of "$text")
  [[ $digest =~ $DIGEST_RE ]] || refuse digest
  login=$(posting_as)
  write_file "$DIR/$digest.md" "$text"
  write_file "$DIR/$digest.login" "$login"
  # An attempt whose outcome is unknown ends here: these bytes got a new ask.
  [ -s "$DIR/$digest.sent" ] || rm -f "${DIR:?}/${digest:?}.sent"
  prune_drafts
  printf 'POSTING_AS %s\nDIGEST %s\nFILE %s\n' "$login" "$digest" "$DIR/$digest.md"
}

# CREATED and ISSUE are separate facts: labels are only ever what the read-back shows.
read_back() {
  local n=${1##*/} seen wanted
  if ! seen=$(gh issue view "$n" --repo "$REPO" --json number,labels \
    --jq '[.number, (.labels[].name)] | @tsv' 2>/dev/null) || [ "${seen%%[!0-9]*}" != "$n" ]; then
    echo "ISSUE unreadable"
    return 6
  fi
  echo "ISSUE ok"
  seen=$'\t'"${seen%"$CR"}"$'\t'
  for wanted in "$KIND_LABEL" "$PROVENANCE"; do
    case $seen in
      *$'\t'"$wanted"$'\t'*) echo "LABEL $wanted set" ;;
      *) echo "LABEL $wanted skipped" ;;
    esac
  done
}

created() {
  echo "CREATED $1"
  read_back "$1" || exit 6
}

unverified() {
  echo "CREATED unverified"
  exit 5
}

cmd_create() {
  [ $# -eq 1 ] || usage
  local digest=$1 marker out line url="" labels
  labels=()
  load_report "$digest"
  marker=$DIR/$digest.sent
  if [ -e "$marker" ]; then
    url=$(cat "$marker" 2>/dev/null)
    [[ $url =~ $ISSUE_URL_RE ]] || unverified
    created "$url"
    return 0
  fi
  [ "$(posting_as)" = "$(cat "$DIR/$digest.login" 2>/dev/null)" ] || refuse identity
  read_repository
  if [ "$CAN_PUSH" = true ] || [ "$CAN_TRIAGE" = true ]; then
    labels=(--label "$KIND_LABEL" --label "$PROVENANCE")
  fi
  # O_EXCL: of two runs that passed the check above, one creates.
  (set -C; : >"$marker") 2>/dev/null || unverified
  out=$(printf '%s' "$BODY" | gh issue create --repo "$REPO" --title "$TITLE" --body-file - \
    ${labels[@]+"${labels[@]}"} 2>/dev/null)
  while IFS= read -r line; do
    line=${line%"$CR"}
    [[ $line =~ $ISSUE_URL_RE ]] && url=$line
  done <<<"$out"
  [ -n "$url" ] || unverified
  printf '%s' "$url" >"$marker"
  created "$url"
}

cmd_link() {
  [ $# -eq 1 ] || usage
  local url
  load_report "$1"
  url="https://github.com/$REPO/issues/new?title=$(printf '%s' "$TITLE" | url_encode)"
  url="$url&body=$(printf '%s' "$BODY" | url_encode)"
  if [ "${#url}" -le "$MAX_LINK" ]; then echo "LINK $url"; else echo "LINK too-long"; fi
}

[ $# -ge 1 ] || usage
sub=$1
shift
case $sub in
  probe) [ $# -eq 0 ] || usage; cmd_probe ;;
  search) cmd_search "$@" ;;
  prepare) cmd_prepare "$@" ;;
  create) cmd_create "$@" ;;
  link) cmd_link "$@" ;;
  *) usage ;;
esac
