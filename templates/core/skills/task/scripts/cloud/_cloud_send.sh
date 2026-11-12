# shellcheck shell=bash
# cloud_send <method> <url> -- the one way a cloud writer sends a request with a
# JSON body, which it reads on stdin. The body goes through cloud_curl
# (_config.sh) from a private file, removed when the request ends; never as an
# argument, where it is visible to every process on the host and a long one
# passes the limit on one command's arguments. Not on curl's stdin either:
# cloud_curl hands curl the Authorization header there. Sourced after
# _config.sh; installed beside it. A subshell, so its EXIT trap is its own.
cloud_send() (
  dir=$(mktemp -d "${TMPDIR:-/tmp}/cloud-body.XXXXXXXX") ||
    { echo "${0##*/}: no temporary directory" >&2; exit 2; }
  trap 'rm -rf -- "$dir"' EXIT
  chmod 700 "$dir"
  cat >"$dir/body.json" || { echo "${0##*/}: could not write the request body" >&2; exit 2; }
  file=$dir/body.json
  # A native Windows curl opens a Windows path, not the one MSYS shows bash.
  if command -v cygpath >/dev/null 2>&1; then file=$(cygpath -m "$file"); fi
  cloud_curl -X "$1" "$2" -H "Content-Type: application/json" --data-binary "@$file"
)
