#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <flagKey> [productName] [configName]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

FLAG_KEY="$1"
PRODUCT_NAME="${2:-Miximodel}"
CONFIG_NAME="${3:-}"

PRODUCT_JSON="$(product_model_by_name "$PRODUCT_NAME")"
PRODUCT_ID="$(printf '%s\n' "$PRODUCT_JSON" | jq -r '.productId // empty')"

if [[ -z "$PRODUCT_ID" ]]; then
  echo "ConfigCat product not found: $PRODUCT_NAME" >&2
  exit 1
fi

CONFIG_JSON="$(config_model_by_name_or_first "$PRODUCT_ID" "$CONFIG_NAME")"
CONFIG_ID="$(printf '%s\n' "$CONFIG_JSON" | jq -r '.configId // empty')"

if [[ -z "$CONFIG_ID" ]]; then
  echo "No ConfigCat config found for product: $PRODUCT_NAME" >&2
  exit 1
fi

SETTING_JSON="$(setting_model_by_key "$CONFIG_ID" "$FLAG_KEY")"
SETTING_ID="$(printf '%s\n' "$SETTING_JSON" | jq -r '.settingId // empty')"

if [[ -z "$SETTING_ID" ]]; then
  echo "Feature flag not found in config $CONFIG_ID: $FLAG_KEY" >&2
  exit 1
fi

ENVIRONMENTS_JSON="$(environments_for_product "$PRODUCT_ID")"
TMP_FILE="$(mktemp)"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

printf '%s\n' "$ENVIRONMENTS_JSON" | jq -c '.[]' | while IFS= read -r environment; do
  environment_id="$(printf '%s\n' "$environment" | jq -r '.environmentId')"
  formula="$(api_request GET "/v2/environments/$environment_id/settings/$SETTING_ID/value")"

  jq -n \
    --argjson environment "$environment" \
    --argjson formula "$formula" \
    '{
      environment: $environment,
      defaultValue: $formula.defaultValue,
      targetingRules: $formula.targetingRules,
      updatedAt: $formula.updatedAt,
      lastVersionId: $formula.lastVersionId
    }' >> "$TMP_FILE"
done

jq -n \
  --argjson product "$PRODUCT_JSON" \
  --argjson config "$CONFIG_JSON" \
  --argjson setting "$SETTING_JSON" \
  --slurpfile environmentStatuses "$TMP_FILE" \
  '{
    product: $product,
    config: $config,
    setting: $setting,
    environments: $environmentStatuses
  }' | print_json