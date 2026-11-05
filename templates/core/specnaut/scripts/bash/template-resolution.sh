#!/usr/bin/env bash
# Template resolution for the spec scripts — the override → preset → extension →
# core stack. Sourced by `common.sh`.

# The enabled preset ids of a `.registry`, lowest priority number first (the
# highest precedence). Exits non-zero on a registry python3 cannot parse, so a
# caller falls back to the directory scan.
_preset_ids_by_priority() {
    SPECNAUT_REGISTRY="$1" python3 -c "
import json, sys, os
try:
    with open(os.environ['SPECNAUT_REGISTRY']) as f:
        data = json.load(f)
    presets = data.get('presets', {})
    for pid, meta in sorted(presets.items(), key=lambda x: x[1].get('priority', 10) if isinstance(x[1], dict) else 10):
        if isinstance(meta, dict) and meta.get('enabled', True) is not False:
            print(pid)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# Resolve a template name to a file path using the priority stack:
#   1. .specnaut/templates/overrides/
#   2. .specnaut/presets/<preset-id>/templates/ (sorted by priority from .registry)
#   3. .specnaut/extensions/<ext-id>/templates/
#   4. .specnaut/templates/ (core)
resolve_template() {
    local template_name="$1"
    local repo_root="$2"
    local base="$repo_root/.specnaut/templates"

    # Priority 1: Project overrides
    local override="$base/overrides/${template_name}.md"
    [ -f "$override" ] && echo "$override" && return 0

    # Priority 2: Installed presets — in registry order when python3 reads
    # `.registry`; otherwise (no registry, no python3, a parse error) in
    # alphabetical directory order. The read sits in the condition so set -e
    # does not abort the function on a registry python3 cannot parse.
    local presets_dir="$repo_root/.specnaut/presets"
    if [ -d "$presets_dir" ]; then
        local registry_file="$presets_dir/.registry"
        local sorted_presets=""
        if [ -f "$registry_file" ] && command -v python3 >/dev/null 2>&1 &&
            sorted_presets=$(_preset_ids_by_priority "$registry_file"); then
            # An empty registry has no presets to search.
            if [ -n "$sorted_presets" ]; then
                while IFS= read -r preset_id; do
                    local candidate="$presets_dir/$preset_id/templates/${template_name}.md"
                    [ -f "$candidate" ] && echo "$candidate" && return 0
                done <<< "$sorted_presets"
            fi
        else
            for preset in "$presets_dir"/*/; do
                [ -d "$preset" ] || continue
                local candidate="$preset/templates/${template_name}.md"
                [ -f "$candidate" ] && echo "$candidate" && return 0
            done
        fi
    fi

    # Priority 3: Extension-provided templates
    local ext_dir="$repo_root/.specnaut/extensions"
    if [ -d "$ext_dir" ]; then
        for ext in "$ext_dir"/*/; do
            [ -d "$ext" ] || continue
            # Skip hidden directories (e.g. .backup, .cache)
            case "$(basename "$ext")" in .*) continue;; esac
            local candidate="$ext/templates/${template_name}.md"
            [ -f "$candidate" ] && echo "$candidate" && return 0
        done
    fi

    # Priority 4: Core templates
    local core="$base/${template_name}.md"
    [ -f "$core" ] && echo "$core" && return 0

    # Template not found in any location.
    # Return 1 so callers can distinguish "not found" from "found".
    # Callers running under set -e should use: TEMPLATE=$(resolve_template ...) || true
    return 1
}
