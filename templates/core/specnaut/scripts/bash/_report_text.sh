# shellcheck shell=bash disable=SC2154
# Sourced by report-upstream.sh (its $DIR and $here used here) and by `text_refusal` in
# _backlog_plan.sh: what is done to text, nothing that talks to a tracker. What the scans
# refuse is listed once, in report-upstream.sh's header: a pattern added here is added there.
# Every scan refuses by exiting through the caller's `refuse`, never by a verdict; a grep that
# cannot run calls `refuse <class> error` (report-upstream.sh: the class; text_refusal: 2).
export LC_ALL=C # The patterns are bytes: under UTF-8, grep's error on HIDDEN_RE would refuse all.
NL=$'\n'
CR=$'\r'
SECRET_RE='gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|(AKIA|ASIA)[0-9A-Z]{12,}|npm_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{16,}|eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.|-----BEGIN|[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]+@'
# Anchored: `task-x`, `global-x`, `risk_live` and `shelf_x` are words, not tokens.
SECRET_RE="$SECRET_RE"'|(^|[^A-Za-z0-9])(gl(pat|ptt|dt|rt|cbt|oas|ft|imt|agent|soat|ffct)-[A-Za-z0-9_-]{16,}|sk-ant-|sk-[A-Za-z0-9_-]{16,}|[sr]k_live|sk_test_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9+/=]{8,}|pypi-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{16,}|SG\.[A-Za-z0-9_-]{16,}|shpat_[A-Za-z0-9]{8,}|dop_v1_[A-Za-z0-9]{8,}|ya29\.[A-Za-z0-9_-]{16,}|xapp-[A-Za-z0-9-]{8,}|dckr_pat_[A-Za-z0-9_-]{8,}|xox[a-z0-9]-)'
# Case-insensitive. A placeholder such as <redacted> is not a value.
SECRET_ANYCASE_RE="(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|credential)[A-Za-z0-9_-]*[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[^[:space:]\"'<]{8,}|authorization[\"']?[[:space:]]*[:=]|(cookie|x-api-key)[[:space:]]*:"
SCHEME_VALUE_RE='(bearer|basic)[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
TOKEN_LIKE_RE='[0-9_~+/=]|[a-z][A-Z]|[A-Za-z0-9]\.[A-Za-z0-9]'
HIDDEN_RE=$'[\x01-\x08\x0b-\x1f\x7f]|\xc2[\x80-\x9f\xad]|\xcd\x8f|\xd8\x9c|\xe1\x85[\x9f\xa0]|\xe1\x9e[\xb4\xb5]|\xe1\xa0[\x8b-\x8e]|\xe2\x80[\x8b-\x8f\xa8-\xae]|\xe2\x81[\xa0-\xaf]|\xe3\x85\xa4|\xef\xb8[\x80-\x8e]|\xef\xbb\xbf|\xef\xbe\xa0|\xef\xbf[\xb9-\xbb]|\xf3\xa0|<!--|^ {0,3}\\[[^]]*\\]:'
ADDRESSING_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+|/(Users|home)/[^/[:space:]]+|(^|[^A-Za-z0-9])[A-Za-z]:\\|(^|[^A-Za-z0-9_.~-])~/|(^|[^A-Za-z0-9_./-])/(srv|workspaces|builds)/|(^|[^A-Za-z0-9_.-])@[A-Za-z0-9]|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+|(^|[^0-9.A-Za-z])(10\.[0-9]{1,3}|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}'
BARE_HOST_RE='(^|[^A-Za-z0-9_./@-])([A-Za-z0-9-]+\.)+(internal|local|corp|lan|com|net|org|io|dev|cloud)[^[:space:]]*'

# A NUL would vanish from a bash variable: it becomes a control character the hidden scan
# refuses. The `x` keeps trailing newlines; a failed read returns 2 without it, never as ''.
read_bytes() { tr '\000' '\001' || return 2; printf x; }

digest_of() {
  local out
  if command -v sha256sum >/dev/null 2>&1; then out=$(printf '%s' "$1" | sha256sum)
  elif command -v shasum >/dev/null 2>&1; then out=$(printf '%s' "$1" | shasum -a 256)
  else out=$(printf '%s' "$1" | openssl dgst -sha256 | sed 's/^.*= *//')
  fi
  printf '%s' "${out%%[!0-9a-f]*}"
}

# grep says 0 hit, 1 no hit; anything else is a scan that did not run, and that refuses.
hit() {
  local class=$1 rc
  grep -aq "${@:2}"
  rc=$?
  [ "$rc" -le 1 ] || refuse "$class" error
  return "$rc"
}

# Sets FOUND to what grep -o prints, under the same rule.
found() {
  local class=$1 rc
  FOUND=$(grep -ao "${@:2}")
  rc=$?
  [ "$rc" -le 1 ] || refuse "$class" error
}

# The value never reaches argv: a `case`, so a process listing cannot show it.
env_secret_in() {
  local name val line
  for name in $(compgen -e); do
    case $name in
      *[Tt][Oo][Kk][Ee][Nn]* | *[Kk][Ee][Yy]* | *[Ss][Ee][Cc][Rr][Ee][Tt]* | *[Pp][Aa][Ss][Ss]*) ;;
      *[Cc][Rr][Ee][Dd]* | *[Dd][Ss][Nn]*) ;;
      *) continue ;;
    esac
    val=${!name-}
    while [ -n "$val" ]; do
      line=${val%%"$NL"*}
      if [ "${#line}" -ge 8 ]; then
        case $1 in *"$line"*) return 0 ;; esac
      fi
      case $val in *"$NL"*) val=${val#*"$NL"} ;; *) val= ;; esac
    done
  done
  return 1
}

# `Bearer token` and `basic functionality` are prose: a credential's value holds a
# digit, a token symbol, mixed case or an inner dot.
scheme_value_in() {
  local _scheme value
  found secret -Ei -- "$SCHEME_VALUE_RE" <<<"$1"
  while read -r _scheme value; do
    [[ $value =~ $TOKEN_LIKE_RE ]] && return 0
  done <<<"$FOUND"
  return 1
}

# Hidden first: a zero-width character inside a token would defeat its pattern.
scan_hard() {
  hit hidden -E -- "$HIDDEN_RE" <<<"$1" && refuse hidden
  hit secret -E -- "$SECRET_RE" <<<"$1" && refuse secret
  hit secret -Ei -- "$SECRET_ANYCASE_RE" <<<"$1" && refuse secret
  scheme_value_in "$1" && refuse secret
  env_secret_in "$1" && refuse secret
}

LITERALS=()
KINDS=()
add_literal() {
  local kind=$1 v low
  shift
  for v in "$@"; do
    v=${v%"$CR"}
    [ "${#v}" -ge 3 ] || continue
    low=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')
    case $low in
      app | apps | src | cli | test | tests | tmp | temp | code | work | dev | main | project | projects) continue ;;
      repo | repos | home | root | user | users | admin | runner | web | api | docs | local | localhost) continue ;;
      sites | documents | desktop | downloads | developer | workspace | workspaces) continue ;;
      git | github | origin | specnaut | specnaut-cli | github.com | gitlab.com | bitbucket.org) continue ;;
    esac
    KINDS[${#LITERALS[@]}]=$kind
    LITERALS[${#LITERALS[@]}]=$v
  done
}

add_segments() {
  local kind=$1 rest=$2
  while [ -n "$rest" ]; do
    add_literal "$kind" "${rest%%/*}"
    case $rest in */*) rest=${rest#*/} ;; *) rest="" ;; esac
  done
}

# A URL, an scp-style remote or a bare slug: the host, and every segment of the path.
add_location() {
  local kind=$1 u=${2%"$CR"} host=""
  u=${u%/}
  u=${u%.git}
  case $u in
    *://*)
      u=${u#*://}
      u=${u#*@}
      host=${u%%[:/]*}
      case $u in */*) u=${u#*/} ;; *) u="" ;; esac
      ;;
    *:*)
      u=${u#*@}
      host=${u%%:*}
      u=${u#*:}
      ;;
  esac
  add_literal "$kind" "$host"
  add_segments "$kind" "$u"
}

# Under $HOME every segment can name the project (~/clients/acme/web); elsewhere the last.
add_directory() {
  case $1 in
    "$HOME"/*) add_segments directory "${1#"$HOME"/}" ;;
    *) add_literal directory "${1##*/}" ;;
  esac
}

add_backlog_config() {
  local line v
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in repo:* | host:* | project_id:* | project_key:* | api_url:*) ;; *) continue ;; esac
    v=${line#*:}
    v=${v%%[[:space:]]#*}
    add_location backlog-repo "$(printf '%s' "$v" | tr -d "\"' \t\r")"
  done <"$1"
}

collect_literals() {
  local host _key url
  host=$(hostname 2>/dev/null) || host=""
  add_literal home "$HOME" "${HOME##*/}" "${USER:-}" "${USERNAME:-}"
  add_literal hostname "$host" "${host%%.*}"
  add_directory "$PWD"
  add_directory "$(git rev-parse --show-toplevel 2>/dev/null)"
  add_literal git-user "$(git config --get user.name 2>/dev/null)" "$(git config --get user.email 2>/dev/null)"
  while read -r _key url; do
    add_location remote "$url"
  done <<<"$(git config --get-regexp '^remote\..*\.url$' 2>/dev/null)"
  add_backlog_config "$PWD/.specnaut/backlog-config.yml"
  add_backlog_config "$here/../../backlog-config.yml"
}

# Scanned twice over: `_` is a word character, so ACME_BILLING would hide `acme`.
scan_literals() {
  local i=0 text="$1$NL${1//_/ }"
  collect_literals
  while [ "$i" -lt "${#LITERALS[@]}" ]; do
    hit literal -iwF -- "${LITERALS[$i]}" <<<"$text" && refuse "literal ${KINDS[$i]}"
    i=$((i + 1))
  done
}

allowed_location() {
  case $1 in
    specnaut.com | specnaut.com/* | example.com | example.com/*) ;;
    github.com | api.github.com | raw.githubusercontent.com) ;;
    github.com/specnaut/* | raw.githubusercontent.com/specnaut/* | api.github.com/repos/specnaut/*) ;;
    *) return 1 ;;
  esac
}

# A host with no scheme. What only looks like one passes: a longer suffix
# (config.local.json) by the host's own end, a path (src/foo.io) by the pattern,
# a version (1.2.dev), and file:line:col in a stack trace.
scan_bare_hosts() {
  local t host rest
  found addressing -Ei -- "$BARE_HOST_RE" <<<"$1"
  for t in $FOUND; do
    t=${t#[!A-Za-z0-9]}
    host=${t%%[!A-Za-z0-9.-]*}
    rest=${t#"$host"}
    host=$(printf '%s' "${host%.}" | tr '[:upper:]' '[:lower:]')
    case $host in *.internal | *.local | *.corp | *.lan | *.com | *.net | *.org | *.io | *.dev | *.cloud) ;; *) continue ;; esac
    case $host in [0-9].* | [0-9][0-9].* | v[0-9].*) continue ;; esac
    case $rest in :[0-9]*:[0-9]*) continue ;; esac
    case $rest in /*) host=$host$rest ;; esac
    allowed_location "$host" || refuse addressing
  done
}

scan_addressing() {
  local url n
  hit addressing -E -- "$ADDRESSING_RE" <<<"$1" && refuse addressing
  found addressing -E -- '[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]+' <<<"$1"
  for url in $FOUND; do
    url=${url#*://}
    case $url in *://* | *..*) refuse addressing ;; esac
    # What closes the sentence or the Markdown link around a URL is not part of it.
    while :; do
      case $url in *[\)\]\"\'\>,.\;:]) url=${url%?} ;; *) break ;; esac
    done
    allowed_location "$url" || refuse addressing
  done
  scan_bare_hosts "$1"
  found addressing -E -- '(^|[^A-Za-z0-9_/&#])#[0-9]+' <<<"$1"
  for n in $FOUND; do
    grep -qx -- "${n##*#}" "$DIR/matches" 2>/dev/null || refuse addressing
  done
}

# scan_all <text> <accept-literals: 0|1>; the report directory is in use by then.
scan_all() {
  scan_hard "$1"
  [ "$2" = 1 ] || scan_literals "$1"
  scan_addressing "$1"
}

url_encode() {
  od -An -v -tx1 | tr ' ' '\n' | awk '
    BEGIN {
      for (i = 48; i <= 57; i++) ok[sprintf("%02x", i)] = sprintf("%c", i)
      for (i = 65; i <= 90; i++) ok[sprintf("%02x", i)] = sprintf("%c", i)
      for (i = 97; i <= 122; i++) ok[sprintf("%02x", i)] = sprintf("%c", i)
      ok["2d"] = "-"; ok["2e"] = "."; ok["5f"] = "_"; ok["7e"] = "~"
    }
    NF { printf "%s", (($1 in ok) ? ok[$1] : "%" toupper($1)) }'
}

# Upstream text is untrusted: letters and plain punctuation survive, on one line.
sanitise_title() {
  local t=$1
  t=${t//\\n/ }
  t=${t//\\t/ }
  t=${t//\\r/ }
  t=${t//:\/\// }
  t=$(printf '%s' "$t" | tr -c "A-Za-z0-9 .,:;_()/+=?!'-" ' ' | tr -s ' ')
  t=${t# }
  t=${t:0:100}
  t=${t% }
  printf '%s' "${t:-untitled}"
}
