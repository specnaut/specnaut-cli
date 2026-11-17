#!/usr/bin/env bash
# The board's address on the local Markdown backend (cli#803). Sourced by
# kanban.sh after _config.sh.

# board_url -- nothing: a Markdown backlog has no web board to open.
board_url() {
  return 0
}

# board_fallback -- where the board lives instead, repo-relative: the index
# render-index.sh keeps. Not a failure: status 0, and nothing is opened.
board_fallback() {
  echo "LOCAL: .specnaut/backlog.md"
}
