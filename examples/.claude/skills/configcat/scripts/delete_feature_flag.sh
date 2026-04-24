#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CONFIG_ID=''
KEY=''
REPO_ROOT="$PWD"
FORCE='false'
ALLOW_REFERENCES='false'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_ID="$2"
      shift 2
      ;;
    --key)
      KEY="$2"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --force)
      FORCE='true'
      shift
      ;;
    --allow-references)
      ALLOW_REFERENCES='true'
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$CONFIG_ID" || -z "$KEY" ]]; then
  echo 'Usage: delete_feature_flag.sh --config <configId> --key <slug> [--repo-root <path>] --force [--allow-references]' >&2
  exit 1
fi

if [[ "$FORCE" != 'true' ]]; then
  echo 'Refusing to delete without --force.' >&2
  echo 'Deleting a feature flag can break runtime expectations, hide dead code, and create dashboard/runtime drift.' >&2
  exit 1
fi

SETTING_ID="$(setting_id_by_key "$CONFIG_ID" "$KEY")"

if [[ -z "$SETTING_ID" ]]; then
  echo "Feature flag not found in config $CONFIG_ID: $KEY" >&2
  exit 1
fi

MATCHES_JSON="$(bash "$SCRIPT_DIR/search_flag_usage.sh" "$KEY" "$REPO_ROOT")"
MATCH_COUNT="$(printf '%s\n' "$MATCHES_JSON" | jq 'length')"

if [[ "$MATCH_COUNT" -gt 0 && "$ALLOW_REFERENCES" != 'true' ]]; then
  echo "Deletion blocked: found $MATCH_COUNT code reference(s) for flag '$KEY'." >&2
  echo 'Review these matches and remove or intentionally accept them before deleting remotely.' >&2
  printf '%s\n' "$MATCHES_JSON" | jq . >&2
  echo 'If you intentionally want to delete despite existing references, rerun with --allow-references.' >&2
  exit 2
fi

echo "WARNING: deleting '$KEY' (settingId=$SETTING_ID) from ConfigCat is irreversible at the API level." >&2
echo 'Consequences may include fallback-to-default behavior, stale code paths, and broken operator expectations.' >&2

api_request DELETE "/v1/settings/$SETTING_ID" >/dev/null

jq -n \
  --arg key "$KEY" \
  --argjson settingId "$SETTING_ID" \
  --argjson referenceCount "$MATCH_COUNT" \
  '{ key: $key, settingId: $settingId, deleted: true, referenceCount: $referenceCount }' | print_json