# shellcheck shell=bash
# The body of smoke-backlog-plan.sh's stand-in `gh`, after the argv log its
# `stub` writes: it answers from $FAKE_ROOT/fake (issue-<n>.json, fields.json,
# labels.json), applies `--jq` itself, and logs a `--body-file`'s content on a
# BODY line. The same answers as tests/scripts/apply_plan_fixture.ts's `gh`.
prev="" jqx=""
for a in "$@"; do
  [ "$prev" != --body-file ] || printf 'BODY\t%s\n' "$(tr '\n' ' ' <"$a")" >>"$FAKE_ROOT/calls"
  [ "$prev" != --jq ] || jqx=$a
  prev=$a
done
out() { if [ -n "$jqx" ]; then jq -r "$jqx"; else cat; fi; }
F="$FAKE_ROOT/fake"
case "$1 $2" in
  "auth status") exit 1 ;;
  "project view") echo '{"id":"PVT"}' | out ;;
  "project field-list") out <"$F/fields.json" ;;
  "project item-add") echo '{"id":"ITEM"}' | out ;;
  "label list") out <"$F/labels.json" ;;
  "issue view") echo '{"body":"Old body"}' | out ;;
  "api graphql")
    case "$*" in *"projectItems(first:5)"*)
      echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM","project":{"id":"PVT"}}]}}}}}' | out
      exit 0 ;;
    esac
    n=""; for a in "$@"; do case "$a" in num=*) n=${a#num=} ;; esac; done
    [ -n "$n" ] && [ -f "$F/issue-$n.json" ] || exit 1
    out <"$F/issue-$n.json" ;;
  "api -X") echo '{}' | out ;;
  "api --paginate") echo '[]' | out ;;
  "api repos/"*)
    n=${2##*/}
    printf '{"state":"open","id":%s,"number":%s}\n' "$((n + 1000))" "$n" | out ;;
esac
exit 0
