#!/usr/bin/env bash
# The release-tag protection gate: `.specnaut/release/preflight.sh` runs this
# file, and tests/scripts/release_tag_protection_test.ts runs it against a
# stubbed `gh`. Needs REPO (owner/name).
#
# The release tag is what installers resolve, so the gate asks GitHub whether a
# repository ruleset holds the `v*` tags against update and deletion, and fails
# the release when none does. It reads with the operator's own `gh`: release.yml
# runs on a `contents: read` token, which cannot read rulesets, so a copy of
# this check there would answer less, not more.
#
# Pass when one ruleset of the tag target is active, includes the release tags
# in a form this script recognises (`refs/tags/v*`, `refs/tags/*`, `~ALL`),
# excludes nothing that could be a release tag (an exclude passes only when it
# starts with `refs/tags/`, holds no wildcard and does not start with
# `refs/tags/v` in any case: `~ALL` and an unprefixed name fail), and has both the
# `update` and the `deletion` rules. Anything else fails, closed: a form not
# recognised here is named, so it can be told from protection that is absent.
#
# Also printed, never judged: the ruleset's exempt actors (`unknown` when the
# token cannot read them, which only an editor of the ruleset can), and the
# repository's immutable-releases state. Immutable releases are compatible with
# release.yml: its publish step creates a draft, uploads, then publishes. Turning
# the setting on is the repository owner's call, not this gate's.
#
# Exit: 0 protected · 1 not protected, or the rulesets could not be read.
set -uo pipefail

[ -n "${REPO:-}" ] || { echo "require-tag-protection: REPO is not set" >&2; exit 1; }

ids="$(gh api "repos/$REPO/rulesets?targets=tag&includes_parents=true&per_page=100" \
  --jq '.[] | select(.enforcement == "active") | .id' 2>/dev/null)" || {
  echo "❌ could not read the tag rulesets of $REPO — an unanswered question is not a pass"
  echo "  (reading rulesets needs a token that can administer $REPO: see \`gh auth status\`)"
  exit 1
}

# One ruleset's verdict, as `OK <name>` or `NO <name>: <why>`, in one jq program.
JUDGE='
  (.conditions.ref_name // {include: [], exclude: []}) as $refs
  | ($refs.include // []) as $inc | ($refs.exclude // []) as $exc
  | [.rules[]?.type] as $rules
  | (if .target != "tag" then "it does not target tags"
     elif ($inc | any(. == "refs/tags/v*" or . == "refs/tags/*" or . == "~ALL")) | not
       then "no include covers the release tags (\($inc | join(", ")))"
     elif ($exc | any((startswith("refs/tags/") | not) or test("[*?\\[{\\\\]")
         or (ascii_downcase | startswith("refs/tags/v"))))
       then "an exclude could remove release tags (\($exc | join(", ")))"
     elif ($rules | index("update")) == null then "no update rule"
     elif ($rules | index("deletion")) == null then "no deletion rule"
     else "" end) as $why
  | if $why == "" then "OK \(.name)" else "NO \(.name): \($why)" end,
    "EXEMPT " + (if (.bypass_actors // null) == null then "unknown (needs an editor of the ruleset)"
      elif (.bypass_actors | length) == 0 then "none"
      else ([.bypass_actors[] | "\(.actor_type):\(.actor_id // "-"):\(.bypass_mode)"] | join(" ")) end)'

protected="" exempt=""
for id in $ids; do
  out="$(gh api "repos/$REPO/rulesets/$id?includes_parents=true" --jq "$JUDGE" 2>/dev/null)" || {
    echo "❌ could not read tag ruleset $id of $REPO"
    exit 1
  }
  verdict="$(sed -n '1p' <<<"$out")"
  case "$verdict" in
    "OK "*) protected="${verdict#OK }" exempt="$(sed -n 's/^EXEMPT //p' <<<"$out")" ;;
    *) echo "  - ruleset ${verdict#NO }" ;;
  esac
done

immutable="$(gh api "repos/$REPO/immutable-releases" --jq 'if .enabled then "enabled" else "disabled" end' 2>/dev/null)" ||
  immutable="unknown"
echo "  immutable releases: $immutable"
if [ -z "$protected" ]; then
  echo "❌ no active tag ruleset holds the release tags against update and deletion"
  exit 1
fi
echo "  exempt actors: $exempt"
echo "  ✓ release tags held by the ruleset \"$protected\""
