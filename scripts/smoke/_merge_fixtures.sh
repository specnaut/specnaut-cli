# shellcheck shell=bash
# Sourced by smoke-merge.sh: scratch-repo fixtures for the merge checks, which
# run the installed scripts instead of grepping their text. Reads $SCAFFOLD.
# m_repo — cd into a fresh clone whose origin's HEAD is main, scripts committed.
m_repo() {
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null LC_ALL=C \
    GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
  local d
  d=$(mktemp -d "${TMPDIR:-/tmp}/smoke-merge.XXXXXX") || return 1
  git init -q --bare -b main "$d/origin.git" && git clone -q "$d/origin.git" "$d/work" 2>/dev/null &&
    cd "$d/work" && mkdir -p .specnaut/scripts && cp -R "$SCAFFOLD/.specnaut/scripts/bash" .specnaut/scripts/ &&
    git add . && git commit -qm base && git push -q origin main && git remote set-head origin main >/dev/null
}
# m_commit <file> <message>… — writes <file>, commits it with each -m.
m_commit() {
  local f=$1 m
  local -a a=()
  shift
  for m in "$@"; do a+=(-m "$m"); done
  mkdir -p "$(dirname "$f")" && echo "$RANDOM" >"$f" && git add "$f" && git commit -q "${a[@]}"
}
# m_shipped — a landed feature 007-x: its spec directory and feature.json, pushed.
m_shipped() {
  m_repo && mkdir -p .specnaut/specs/007-x && echo plan >.specnaut/specs/007-x/plan.md &&
    printf '{"feature_directory": "%s", "linked_issue": 7}\n' "${1:-.specnaut/specs/007-x}" >.specnaut/feature.json &&
    git add .specnaut && git commit -qm "plan(7): x" && git push -q origin main
}
# m_epic — an epic branch of two children, the first with a fixup written against it.
m_epic() {
  m_repo && git switch -q -c epic && m_commit a "feat(T01): a (#51)" "Epic: #50" &&
    local t01 && t01=$(git rev-parse HEAD) && m_commit b "feat(T02): b (#52)" "Epic: #50" &&
    echo fixed >a && git add a && git commit -q --fixup="$t01"
}
