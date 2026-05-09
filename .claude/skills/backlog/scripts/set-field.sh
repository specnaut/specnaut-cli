#!/usr/bin/env bash
# Set a native Project V2 single-select field value (Priority or Size) on an
# issue on Specflow's own Project #4. Hardcoded mirror of the templated helper
# at templates/core/skills/backlog/scripts/github/set-field.sh.
#
# Usage: set-field.sh <issue-number> <Priority|Size> <value>
#
# Exit codes:
#   0   field updated
#   10  no such field on the project (caller should fall back to a label)
#   11  field exists but has no option matching <value> (caller should fall back to a label)
#   12  issue is not on Project #4
#   1   usage / unexpected error
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh <issue-number> <Priority|Size> <value>' >&2
  exit 1
fi
ISSUE="$1"
FIELD_NAME="$2"
VALUE="$3"

PROJECT_ID="PVT_kwDOBv46cs4BV4Gz"

case "$(echo "$FIELD_NAME" | tr '[:upper:]' '[:lower:]')" in
  priority)
    FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrbw"
    CANONICAL="Priority"
    case "$VALUE" in
      P0) OPT="79628723" ;;
      P1) OPT="0a877460" ;;
      P2) OPT="da944a9c" ;;
      P3)
        echo "field 'Priority' has no option 'P3' — fall back to label" >&2
        exit 11
        ;;
      *)
        echo "unknown Priority value '$VALUE' (P0|P1|P2)" >&2
        exit 11
        ;;
    esac
    ;;
  size)
    FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrb0"
    CANONICAL="Size"
    case "$VALUE" in
      XS) OPT="6c6483d2" ;;
      S)  OPT="f784b110" ;;
      M)  OPT="7515a9f1" ;;
      L)  OPT="817d0097" ;;
      XL) OPT="db339eb2" ;;
      *)
        echo "unknown Size value '$VALUE' (XS|S|M|L|XL)" >&2
        exit 11
        ;;
    esac
    ;;
  *)
    echo "error: unsupported field '$FIELD_NAME' (Priority|Size)" >&2
    exit 1
    ;;
esac

ITEM_ID=$(gh api graphql -f query='
  query($num: Int!) {
    repository(owner:"mkrlabs", name:"specflow") {
      issue(number: $num) {
        projectItems(first: 5) {
          nodes { id project { number } }
        }
      }
    }
  }' -F num="$ISSUE" \
  | jq -r '.data.repository.issue.projectItems.nodes[] | select(.project.number == 4) | .id')

if [ -z "$ITEM_ID" ]; then
  echo "issue #$ISSUE is not on Project #4" >&2
  exit 12
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$OPT" >/dev/null

echo "✓ #$ISSUE $CANONICAL → $VALUE"
