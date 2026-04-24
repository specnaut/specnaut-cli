#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo 'Usage: configcat_flag.sh <inspect|add|update|delete|search|api> ...' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="$1"
shift

case "$COMMAND" in
  inspect)
    SUBCOMMAND="${1:-}"
    shift || true
    case "$SUBCOMMAND" in
      products)
        bash "$SCRIPT_DIR/list_products.sh" "$@"
        ;;
      configs)
        bash "$SCRIPT_DIR/list_product_configs.sh" "$@"
        ;;
      environments)
        bash "$SCRIPT_DIR/list_product_environments.sh" "$@"
        ;;
      project-environments)
        bash "$SCRIPT_DIR/list_project_environments.sh" "$@"
        ;;
      settings)
        bash "$SCRIPT_DIR/list_config_settings.sh" "$@"
        ;;
      values)
        bash "$SCRIPT_DIR/list_config_values.sh" "$@"
        ;;
      flag-status)
        bash "$SCRIPT_DIR/inspect_flag_status.sh" "$@"
        ;;
      *)
        echo 'Usage: configcat_flag.sh inspect <products|configs|environments|project-environments|settings|values|flag-status> ...' >&2
        exit 1
        ;;
    esac
    ;;
  add)
    bash "$SCRIPT_DIR/add_feature_flag.sh" "$@"
    ;;
  update)
    bash "$SCRIPT_DIR/update_feature_flag.sh" "$@"
    ;;
  delete)
    bash "$SCRIPT_DIR/delete_feature_flag.sh" "$@"
    ;;
  search)
    bash "$SCRIPT_DIR/search_flag_usage.sh" "$@"
    ;;
  api)
    bash "$SCRIPT_DIR/configcat_api.sh" "$@"
    ;;
  *)
    echo "Unknown ConfigCat command: $COMMAND" >&2
    exit 1
    ;;
esac