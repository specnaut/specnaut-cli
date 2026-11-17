#!/usr/bin/env bash
# The board's browser address on the GitHub backend (cli#803). Sourced by
# kanban.sh after _config.sh, whose REPO_OWNER and PROJECT_NUMBER it reads.

# board_url -- the Project V2 board's URL, or nothing. The owner kind (orgs/
# or users/) is GitHub's answer, never guessed from the name: `gh` reports
# the project's own `url`, and only a plain board URL for the configured
# number is kept. Never fails; nothing printed is the caller's fallback.
board_url() {
  local url
  url=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json \
    --jq .url 2>/dev/null) || return 0
  url=${url%$'\r'}
  case $url in *$'\n'*) return 0 ;; esac
  LC_ALL=C grep -Eq '^https://github\.com/(orgs|users)/[A-Za-z0-9-]+/projects/[0-9]+$' \
    <<<"$url" || return 0
  [ "${url##*/}" = "$PROJECT_NUMBER" ] || return 0
  printf '%s\n' "$url"
}

# board_fallback -- what the user is told when board_url found nothing: the
# project could not be read, so the URL is not known. Status 13, as for
# require_project: retry or report, never a reason to edit the config.
board_fallback() {
  echo "error: could not read project #$PROJECT_NUMBER of '$REPO_OWNER' from GitHub." >&2
  echo "  Check that gh is installed and signed in: gh auth status" >&2
  echo "  A token without the project scope: gh auth refresh -s read:project" >&2
  return 13
}
