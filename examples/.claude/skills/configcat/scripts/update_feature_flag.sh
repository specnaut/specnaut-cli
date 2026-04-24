#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CONFIG_ID=''
ENVIRONMENT_ID=''
KEY=''
NAME=''
HINT=''
CLEAR_HINT='false'
VALUE=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_ID="$2"
      shift 2
      ;;
    --environment)
      ENVIRONMENT_ID="$2"
      shift 2
      ;;
    --key)
      KEY="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --hint)
      HINT="$2"
      shift 2
      ;;
    --clear-hint)
      CLEAR_HINT='true'
      shift
      ;;
    --value)
      VALUE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$CONFIG_ID" || -z "$KEY" ]]; then
  echo 'Usage: update_feature_flag.sh --config <configId> --key <slug> [--name <displayName>] [--hint <text>] [--clear-hint] [--environment <environmentId> --value true|false]' >&2
  exit 1
fi

if [[ -n "$VALUE" && "$VALUE" != 'true' && "$VALUE" != 'false' ]]; then
  echo 'Feature flag value must be true or false' >&2
  exit 1
fi

if [[ -z "$NAME" && -z "$HINT" && "$CLEAR_HINT" != 'true' && -z "$VALUE" ]]; then
  echo 'Nothing to update. Provide metadata and/or a value change.' >&2
  exit 1
fi

SETTING_ID="$(setting_id_by_key "$CONFIG_ID" "$KEY")"

if [[ -z "$SETTING_ID" ]]; then
  echo "Feature flag not found in config $CONFIG_ID: $KEY" >&2
  exit 1
fi

METADATA_FILE="$(mktemp)"
VALUE_FILE="$(mktemp)"
METADATA_RESPONSE="$(mktemp)"
VALUE_RESPONSE="$(mktemp)"
printf 'null\n' > "$METADATA_RESPONSE"
printf 'null\n' > "$VALUE_RESPONSE"
cleanup() {
  rm -f "$METADATA_FILE" "$VALUE_FILE" "$METADATA_RESPONSE" "$VALUE_RESPONSE"
}
trap cleanup EXIT

METADATA_UPDATED='false'
VALUE_UPDATED='false'

jq -n \
  --arg name "$NAME" \
  --arg hint "$HINT" \
  --argjson clearHint "$CLEAR_HINT" \
  '[
    (if $name != "" then { op: "replace", path: "/name", value: $name } else empty end),
    (if $hint != "" then { op: "replace", path: "/hint", value: $hint } else empty end),
    (if $clearHint then { op: "replace", path: "/hint", value: null } else empty end)
  ]' > "$METADATA_FILE"

if [[ "$(jq 'length' "$METADATA_FILE")" -gt 0 ]]; then
  api_request PATCH "/v1/settings/$SETTING_ID" "$METADATA_FILE" > "$METADATA_RESPONSE"
  METADATA_UPDATED='true'
fi

if [[ -n "$VALUE" ]]; then
  if [[ -z "$ENVIRONMENT_ID" ]]; then
    echo 'Updating a flag value requires --environment <environmentId>' >&2
    exit 1
  fi

  jq -n --argjson value "$VALUE" '[{ op: "replace", path: "/value", value: $value }]' > "$VALUE_FILE"
  api_request PATCH "/v1/environments/$ENVIRONMENT_ID/settings/$SETTING_ID/value" "$VALUE_FILE" > "$VALUE_RESPONSE"
  VALUE_UPDATED='true'
fi

jq -n \
  --arg key "$KEY" \
  --argjson settingId "$SETTING_ID" \
  --argjson metadataUpdated "$METADATA_UPDATED" \
  --argjson valueUpdated "$VALUE_UPDATED" \
  --slurpfile metadata "$METADATA_RESPONSE" \
  --slurpfile valueResponse "$VALUE_RESPONSE" \
  '{
    key: $key,
    settingId: $settingId,
    metadataUpdated: $metadataUpdated,
    valueUpdated: $valueUpdated,
    metadata: ($metadata[0] // null),
    value: ($valueResponse[0] // null)
  }' | print_json