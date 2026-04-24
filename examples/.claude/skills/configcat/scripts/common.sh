#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SKILL_DIR/.env"
CONFIGCAT_API_BASE_URL_DEFAULT='https://api.configcat.com'

load_skill_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing ConfigCat skill .env file: $ENV_FILE" >&2
    exit 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$ENV_FILE"
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
}

configcat_api_base_url() {
  printf '%s' "${CONFIGCAT_API_BASE_URL:-$CONFIGCAT_API_BASE_URL_DEFAULT}"
}

configcat_auth_header() {
  if [[ -n "${CONFIGCAT_AUTHORIZATION_HEADER:-}" ]]; then
    printf '%s' "$CONFIGCAT_AUTHORIZATION_HEADER"
    return
  fi

  if [[ -n "${CONFIGCAT_AUTHORIZATION_HEADER_BASE64:-}" ]]; then
    printf 'Basic %s' "$CONFIGCAT_AUTHORIZATION_HEADER_BASE64"
    return
  fi

  if [[ -n "${CONFIGCAT_BASIC_AUTH_USERNAME:-}" && -n "${CONFIGCAT_BASIC_AUTH_PASSWORD:-}" ]]; then
    local encoded
    encoded="$(printf '%s:%s' "$CONFIGCAT_BASIC_AUTH_USERNAME" "$CONFIGCAT_BASIC_AUTH_PASSWORD" | base64 | tr -d '\n')"
    printf 'Basic %s' "$encoded"
    return
  fi

  echo 'Missing ConfigCat authorization credentials in skill .env' >&2
  exit 1
}

api_request() {
  local method="$1"
  local path="$2"
  local body_file="${3:-}"
  local tmp_body
  local http_status
  tmp_body="$(mktemp)"

  local -a curl_args
  curl_args=(
    -sS
    -o "$tmp_body"
    -w '%{http_code}'
    -X "$method"
    -H "Authorization: $(configcat_auth_header)"
    -H 'Accept: application/json'
  )

  if [[ -n "$body_file" ]]; then
    curl_args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  fi

  http_status="$(curl "${curl_args[@]}" "$(configcat_api_base_url)$path")"

  if [[ "$http_status" -lt 200 || "$http_status" -ge 300 ]]; then
    echo "ConfigCat API request failed with HTTP $http_status" >&2
    cat "$tmp_body" >&2
    rm -f "$tmp_body"
    exit 1
  fi

  if [[ ! -s "$tmp_body" ]]; then
    rm -f "$tmp_body"
    return 0
  fi

  cat "$tmp_body"
  rm -f "$tmp_body"
}

print_json() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

product_model_by_name() {
  local product_name="${1:-Miximodel}"

  api_request GET '/v1/products' |
    jq -c --arg productName "$product_name" '
      map(select((.name | ascii_downcase) == ($productName | ascii_downcase)))
      | .[0] // empty
    '
}

product_id_by_name() {
  local product_name="${1:-Miximodel}"

  product_model_by_name "$product_name" | jq -r '.productId // empty'
}

configs_for_product() {
  local product_id="$1"

  api_request GET "/v1/products/$product_id/configs"
}

config_model_by_name_or_first() {
  local product_id="$1"
  local config_name="${2:-}"

  if [[ -z "$config_name" ]]; then
    configs_for_product "$product_id" | jq -c 'sort_by(.order) | .[0] // empty'
    return
  fi

  configs_for_product "$product_id" |
    jq -c --arg configName "$config_name" '
      map(select((.name | ascii_downcase) == ($configName | ascii_downcase)))
      | .[0] // empty
    '
}

config_id_by_name_or_first() {
  local product_id="$1"
  local config_name="${2:-}"

  config_model_by_name_or_first "$product_id" "$config_name" | jq -r '.configId // empty'
}

environments_for_product() {
  local product_id="$1"

  api_request GET "/v1/products/$product_id/environments"
}

setting_model_by_key() {
  local config_id="$1"
  local key="$2"

  api_request GET "/v1/configs/$config_id/settings" |
    jq -c --arg key "$key" 'map(select(.key == $key)) | .[0] // empty'
}

setting_id_by_key() {
  local config_id="$1"
  local key="$2"

  setting_model_by_key "$config_id" "$key" | jq -r '.settingId // empty'
}

load_skill_env
require_command curl
require_command jq