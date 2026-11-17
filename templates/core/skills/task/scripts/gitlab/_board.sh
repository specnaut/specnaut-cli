#!/usr/bin/env bash
# The board's browser address on the GitLab backend (cli#803). Sourced by
# kanban.sh after _config.sh, whose host_base and _gitlab_web_path it uses.

# board_url -- the project's issue board, `<host>/<group>/<project>/-/boards`,
# or nothing: the path is the one item_url links with, numeric ids resolved
# the same way. Never fails; nothing printed is the caller's fallback.
board_url() {
  _gitlab_web_path || return 0
  echo "$(host_base)/$GITLAB_WEB_PATH/-/boards"
}

# board_fallback -- what the user is told when board_url found nothing: a
# numeric project_id could not be resolved to its path. Status 13: retry or
# report, never a reason to edit the config.
board_fallback() {
  echo "error: could not resolve GitLab project $PROJECT_ID to its path on $HOST." >&2
  echo "  Check that glab is installed and signed in to that host: glab auth status" >&2
  echo "  Or set project_id to the group/project path in $CONFIG." >&2
  return 13
}
