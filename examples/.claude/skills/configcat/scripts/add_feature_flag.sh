#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CONFIG_ID=''
ENVIRONMENT_ID=''
KEY=''
NAME=''
VALUE='false'
HINT=''

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
    --value)
      VALUE="$2"
      shift 2
      ;;
    --hint)
      HINT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$CONFIG_ID" || -z "$ENVIRONMENT_ID" || -z "$KEY" ]]; then
  echo 'Usage: add_feature_flag.sh --config <configId> --environment <environmentId> --key <slug> [--name <displayName>] [--value true|false] [--hint <text>]' >&2
  exit 1
fi

if [[ "$VALUE" != 'true' && "$VALUE" != 'false' ]]; then
  echo 'Feature flag value must be true or false' >&2
  exit 1
fi

if [[ -z "$NAME" ]]; then
  NAME="$KEY"
fi

PAYLOAD_FILE="$(mktemp)"
cleanup() {
  rm -f "$PAYLOAD_FILE"
}
trap cleanup EXIT

jq -n \
  --arg key "$KEY" \
  --arg name "$NAME" \
  --arg hint "$HINT" \
  --arg environmentId "$ENVIRONMENT_ID" \
  --argjson value "$VALUE" \
  '{
    key: $key,
    name: $name,
    hint: (if $hint == "" then null else $hint end),
    settingType: "boolean",
    initialValues: [
      {
        environmentId: $environmentId,
        value: $value
      }
    ]
  }' > "$PAYLOAD_FILE"

api_request POST "/v1/configs/$CONFIG_ID/settings" "$PAYLOAD_FILE" | print_json