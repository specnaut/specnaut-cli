#!/usr/bin/env bash
# PreToolUse(Agent|Task on Claude, spawn_agent on Codex) — a Specnaut agent
# runs on the tier its definition declares (spec 036, FR-003). The one home of
# "does this dispatch override a Specnaut agent's model" (plan § 5); the "no
# model: override" sentence in the skills stays as the reason, not the rule.
#
# Read: Claude tool_input.{subagent_type,model}; Codex
# tool_input.{agent_type,model,reasoning_effort} — both Codex fields move an
# agent off its tier (§ 11 Measured). Never the top-level `model`: that is the
# session's own, present in every Codex payload.
#
# A Specnaut agent: `${name##*:}` (a plugin prefix dropped) is listed in
# _agents.txt beside this script, generated from the manifest. An agent file
# alone is not proof: the user's own agents live there too, and FR-003 never
# touches them. A name that is not a plain token cannot be checked, so with an
# override set it is refused (§ 11 F9); so is a missing list. No name is the
# harness's default agent: never ours.
#
# Usage: guard-dispatch-model.sh <claude|codex>   (payload on stdin)
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
guard_init guard-dispatch-model "${1:-}" \
  .tool_input.subagent_type .tool_input.agent_type any:.tool_input.model any:.tool_input.reasoning_effort

case "$GUARD_HARNESS:$P_TOOL" in
  claude:Agent | claude:Task) name=${GF[0]} override=${GF[2]} ;;
  codex:spawn_agent) name=${GF[1]} override=${GF[2]}${GF[3]} ;;
  *) guard_fail "expected an agent dispatch, got tool '$P_TOOL' on $GUARD_HARNESS" ;;
esac
[ -n "$override" ] || guard_allow
[ -n "$name" ] || guard_allow
[[ $name =~ ^[A-Za-z0-9:_-]+$ ]] \
  || guard_fail "the agent name '$name' is not a plain name, so it cannot be checked — dispatch it without a model override"

agent=${name##*:}
[ -f "$HOOK_DIR/_agents.txt" ] \
  || guard_fail "$HOOK_DIR/_agents.txt is missing, so '$agent' cannot be checked — dispatch it without a model override"
grep -qxF -- "$agent" "$HOOK_DIR/_agents.txt" || guard_allow

guard_fail "'$agent' is a Specnaut agent: it runs on the model its definition declares, and a dispatch may not choose another tier. Dispatch it again without model or reasoning_effort."
