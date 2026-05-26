#!/usr/bin/env bash
# One-shot sweep: copy `priority:*` and `size:*` labels into the matching
# native Project V2 single-select fields on Project #4, then strip the labels
# from issues where the field write succeeded.
#
# Idempotent. Safe to re-run. Issues with no priority/size label are skipped.
# `priority:P3` has no native field option (Project #4 only has P0..P2) — the
# label is preserved and the migration is reported as "label-only" for that
# dimension.
#
# Usage: migrate-labels-to-fields.sh [--repo <short>] [--dry-run]
#   <short> ∈ specflow | specflow-cloud | specflow-monorepo (default: specflow)
set -euo pipefail

DRY_RUN=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then
    DRY_RUN=1
  else
    ARGS+=("$a")
  fi
done

. "$(dirname "$0")/_repo.sh"
resolve_repo ${ARGS[@]+"${ARGS[@]}"}
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

ROOT="$(cd "$(dirname "$0")" && pwd)"
SET_FIELD="$ROOT/set-field.sh"

if [ ! -x "$SET_FIELD" ]; then
  echo "error: $SET_FIELD not executable" >&2
  exit 1
fi

REPO_SHORT="${REPO#mkrlabs/}"

# Pull every open issue with at least one priority:* or size:* label.
ISSUES=$(gh issue list \
  --repo "$REPO" \
  --state open \
  --limit 200 \
  --json number,labels \
  --jq '
    .[]
    | . as $i
    | (.labels | map(.name)) as $names
    | select(($names | any(test("^(priority|size):"))))
    | { number: $i.number, labels: $names }
  ')

if [ -z "$ISSUES" ]; then
  echo "no issues with priority:*/size:* labels in $REPO — nothing to migrate"
  exit 0
fi

migrated=0
skipped_p3=0
errored=0

while IFS= read -r row; do
  num=$(echo "$row" | jq -r '.number')
  labels=$(echo "$row" | jq -r '.labels[]')

  prio=""
  size=""
  while IFS= read -r lbl; do
    case "$lbl" in
      priority:P0 | priority:P1 | priority:P2 | priority:P3) prio="${lbl#priority:}" ;;
      size:XS | size:S | size:M | size:L | size:XL) size="${lbl#size:}" ;;
    esac
  done <<<"$labels"

  if [ -z "$prio" ] && [ -z "$size" ]; then
    continue
  fi

  echo "$REPO#$num: priority=${prio:-—}, size=${size:-—}"

  if [ -n "$prio" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "  (dry-run) would set Priority=$prio"
    else
      set +e
      "$SET_FIELD" --repo "$REPO_SHORT" "$num" Priority "$prio" 1>/dev/null
      rc=$?
      set -e
      case $rc in
        0)
          gh issue edit "$num" --repo "$REPO" --remove-label "priority:$prio" >/dev/null
          echo "  ✓ Priority=$prio (label stripped)"
          migrated=$((migrated + 1))
          ;;
        11)
          echo "  ↳ Priority=$prio kept as label (no native option, e.g. P3)"
          skipped_p3=$((skipped_p3 + 1))
          ;;
        *)
          echo "  ✗ Priority=$prio failed (exit $rc)"
          errored=$((errored + 1))
          ;;
      esac
    fi
  fi

  if [ -n "$size" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "  (dry-run) would set Size=$size"
    else
      set +e
      "$SET_FIELD" --repo "$REPO_SHORT" "$num" Size "$size" 1>/dev/null
      rc=$?
      set -e
      case $rc in
        0)
          gh issue edit "$num" --repo "$REPO" --remove-label "size:$size" >/dev/null
          echo "  ✓ Size=$size (label stripped)"
          migrated=$((migrated + 1))
          ;;
        11)
          echo "  ↳ Size=$size kept as label (no native option)"
          skipped_p3=$((skipped_p3 + 1))
          ;;
        *)
          echo "  ✗ Size=$size failed (exit $rc)"
          errored=$((errored + 1))
          ;;
      esac
    fi
  fi
done <<<"$ISSUES"

echo
echo "summary: migrated=$migrated, kept-as-label=$skipped_p3, errored=$errored"
