#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PRODUCT_NAME="${1:-Miximodel}"
PRODUCT_ID="$(product_id_by_name "$PRODUCT_NAME")"

if [[ -z "$PRODUCT_ID" ]]; then
  echo "ConfigCat product not found: $PRODUCT_NAME" >&2
  exit 1
fi

environments_for_product "$PRODUCT_ID" | print_json