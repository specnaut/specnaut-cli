# shellcheck shell=bash
# Sourced by _common.sh, never run: the context-file checks the scaffold smokes
# share, on their own so the shared header stays within its size.

# --- The context file (cli#680) -----------------------------------------
# One spelling of "a harness context file is a relative link to the root
# AGENTS.md", for every script that asserts one. `-L`, not `-f`: `-f` follows
# the link, and a plain copy of AGENTS.md would pass it.
# check_context_link "<label>" <file> <target>
check_context_link() {
  local got
  if [ ! -L "$2" ]; then fail "$1" "$2 is not a symlink"; return; fi
  got="$(readlink "$2")"
  if [ "$got" != "$3" ]; then fail "$1" "$2 points at '$got', not '$3'"; return; fi
  pass "$1"
}

# check_context_file <backend> — from a claude scaffold's root (#612, cli#680):
# `.claude/CLAUDE.md` links to AGENTS.md, no root CLAUDE.md is written, and
# AGENTS.md describes the backend it was given — the local index on `local`
# only, the backlog config on every other — with no retired path and no
# unrendered backend marker.
check_context_file() {
  check_context_link ".claude/CLAUDE.md is a relative symlink to the root AGENTS.md (cli#680)" \
    .claude/CLAUDE.md ../AGENTS.md
  check "no root CLAUDE.md is written (cli#680)" '[ ! -e CLAUDE.md ]'
  if [ "$1" = local ]; then
    check "AGENTS.md points a local project at its backlog index" \
      'grep -q "\.specnaut/backlog\.md" AGENTS.md && [ -f .specnaut/backlog.md ]'
  else
    check "AGENTS.md does not send a $1 project to the local index" \
      '! grep -q "\.specnaut/backlog\.md" AGENTS.md'
    check "AGENTS.md points at the backlog config it was given" \
      'grep -q "\.specnaut/backlog-config\.yml" AGENTS.md'
  fi
  check "AGENTS.md does not cite the retired .claude/commands/" \
    '! grep -q "\.claude/commands/" AGENTS.md'
  check "AGENTS.md carries no unrendered backend markers" '! grep -q "backend=" AGENTS.md'
}
