#!/usr/bin/env bash
# The board's browser address on the Specnaut Cloud backend (cli#803).
# Sourced by kanban.sh after _config.sh, whose PROJECT_KEY it reads.

# board_url -- nothing, yet. The public HTTP contract exposes no web address
# for a board, and an API base is not a web origin: NEVER derive one from the
# configured api_url. When the contract carries a board address, read it here.
board_url() {
  return 0
}

# board_fallback -- the defined no-link answer: the project key, and where the
# board is reached. Not a failure: status 0.
board_fallback() {
  echo "CLOUD: project $PROJECT_KEY - open the board from the Specnaut Cloud web app"
}
