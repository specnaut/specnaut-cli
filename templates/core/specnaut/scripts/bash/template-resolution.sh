#!/usr/bin/env bash
# Template resolution for the spec scripts — the override → preset → extension →
# core stack and the presets' composition strategies. Sourced by `common.sh`.

# The enabled preset ids of a `.registry`, lowest priority number first (the
# highest precedence). Exits non-zero on a registry python3 cannot parse, so a
# caller falls back to the directory scan. Both resolvers read this one order.
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

# Resolve a template name to composed content using composition strategies.
# Reads strategy metadata from preset manifests and composes content
# from multiple layers using prepend, append, or wrap strategies.
#
# Usage: CONTENT=$(resolve_template_content "template-name" "$REPO_ROOT")
# Returns composed content string on stdout; exit code 1 if not found.
resolve_template_content() {
    local template_name="$1"
    local repo_root="$2"
    local base="$repo_root/.specnaut/templates"

    # Collect all layers (highest priority first)
    local -a layer_paths=()
    local -a layer_strategies=()

    # Priority 1: Project overrides (always "replace")
    local override="$base/overrides/${template_name}.md"
    if [ -f "$override" ]; then
        layer_paths+=("$override")
        layer_strategies+=("replace")
    fi

    # Priority 2: Installed presets (sorted by priority from .registry)
    local presets_dir="$repo_root/.specnaut/presets"
    if [ -d "$presets_dir" ]; then
        local registry_file="$presets_dir/.registry"
        local sorted_presets=""
        if [ -f "$registry_file" ] && command -v python3 >/dev/null 2>&1; then
            if sorted_presets=$(_preset_ids_by_priority "$registry_file"); then
                if [ -n "$sorted_presets" ]; then
                    local yaml_warned=false
                    while IFS= read -r preset_id; do
                        # Read strategy and file path from preset manifest
                        local strategy="replace"
                        local manifest_file=""
                        local manifest="$presets_dir/$preset_id/preset.yml"
                        if [ -f "$manifest" ] && command -v python3 >/dev/null 2>&1; then
                            # Requires PyYAML; falls back to replace/convention if unavailable
                            local result
                            local py_stderr
                            py_stderr=$(mktemp)
                            result=$(SPECNAUT_MANIFEST="$manifest" SPECNAUT_TMPL="$template_name" python3 -c "
import sys, os
try:
    import yaml
except ImportError:
    print('yaml_missing', file=sys.stderr)
    print('replace\t')
    sys.exit(0)
try:
    with open(os.environ['SPECNAUT_MANIFEST']) as f:
        data = yaml.safe_load(f)
    for t in data.get('provides', {}).get('templates', []):
        if t.get('name') == os.environ['SPECNAUT_TMPL'] and t.get('type', 'template') == 'template':
            print(t.get('strategy', 'replace') + '\t' + t.get('file', ''))
            sys.exit(0)
    print('replace\t')
except Exception:
    print('replace\t')
" 2>"$py_stderr")
                            local parse_status=$?
                            if [ $parse_status -eq 0 ] && [ -n "$result" ]; then
                                IFS=$'\t' read -r strategy manifest_file <<< "$result"
                                strategy=$(printf '%s' "$strategy" | tr '[:upper:]' '[:lower:]')
                            fi
                            if [ "$yaml_warned" = false ] && grep -q 'yaml_missing' "$py_stderr" 2>/dev/null; then
                                echo "Warning: PyYAML not available; composition strategies may be ignored" >&2
                                yaml_warned=true
                            fi
                            rm -f "$py_stderr"
                        fi
                        # Try manifest file path first, then convention path
                        local candidate=""
                        if [ -n "$manifest_file" ]; then
                            # Reject absolute paths and parent traversal
                            case "$manifest_file" in
                                /*|*../*) manifest_file="" ;;
                            esac
                        fi
                        if [ -n "$manifest_file" ]; then
                            local mf="$presets_dir/$preset_id/$manifest_file"
                            [ -f "$mf" ] && candidate="$mf"
                        fi
                        if [ -z "$candidate" ]; then
                            local cf="$presets_dir/$preset_id/templates/${template_name}.md"
                            [ -f "$cf" ] && candidate="$cf"
                        fi
                        if [ -n "$candidate" ]; then
                            layer_paths+=("$candidate")
                            layer_strategies+=("$strategy")
                        fi
                    done <<< "$sorted_presets"
                fi
            else
                # python3 failed — fall back to unordered directory scan (replace only)
                for preset in "$presets_dir"/*/; do
                    [ -d "$preset" ] || continue
                    local candidate="$preset/templates/${template_name}.md"
                    if [ -f "$candidate" ]; then
                        layer_paths+=("$candidate")
                        layer_strategies+=("replace")
                    fi
                done
            fi
        else
            # No python3 or registry — fall back to unordered directory scan (replace only)
            for preset in "$presets_dir"/*/; do
                [ -d "$preset" ] || continue
                local candidate="$preset/templates/${template_name}.md"
                if [ -f "$candidate" ]; then
                    layer_paths+=("$candidate")
                    layer_strategies+=("replace")
                fi
            done
        fi
    fi

    # Priority 3: Extension-provided templates (always "replace")
    local ext_dir="$repo_root/.specnaut/extensions"
    if [ -d "$ext_dir" ]; then
        for ext in "$ext_dir"/*/; do
            [ -d "$ext" ] || continue
            case "$(basename "$ext")" in .*) continue;; esac
            local candidate="$ext/templates/${template_name}.md"
            if [ -f "$candidate" ]; then
                layer_paths+=("$candidate")
                layer_strategies+=("replace")
            fi
        done
    fi

    # Priority 4: Core templates (always "replace")
    local core="$base/${template_name}.md"
    if [ -f "$core" ]; then
        layer_paths+=("$core")
        layer_strategies+=("replace")
    fi

    local count=${#layer_paths[@]}
    [ "$count" -eq 0 ] && return 1

    # Check if any layer uses a non-replace strategy
    local has_composition=false
    for s in "${layer_strategies[@]}"; do
        [ "$s" != "replace" ] && has_composition=true && break
    done

    # If the top (highest-priority) layer is replace, it wins entirely —
    # lower layers are irrelevant regardless of their strategies.
    if [ "${layer_strategies[0]}" = "replace" ]; then
        cat "${layer_paths[0]}"
        return 0
    fi

    if [ "$has_composition" = false ]; then
        cat "${layer_paths[0]}"
        return 0
    fi

    # Find the effective base: scan from highest priority (index 0) downward
    # to find the nearest replace layer. Only compose layers above that base.
    local base_idx=-1
    local i
    for (( i=0; i<count; i++ )); do
        if [ "${layer_strategies[$i]}" = "replace" ]; then
            base_idx=$i
            break
        fi
    done

    if [ $base_idx -lt 0 ]; then
        return 1  # no base layer found
    fi

    # Read the base content; compose layers above the base (higher priority)
    local content
    content=$(cat "${layer_paths[$base_idx]}"; printf x)
    content="${content%x}"

    for (( i=base_idx-1; i>=0; i-- )); do
        local path="${layer_paths[$i]}"
        local strat="${layer_strategies[$i]}"
        local layer_content
        # Preserve trailing newlines
        layer_content=$(cat "$path"; printf x)
        layer_content="${layer_content%x}"

        case "$strat" in
            replace) content="$layer_content" ;;
            prepend) content="$(printf '%s\n\n%s' "$layer_content" "$content")" ;;
            append)  content="$(printf '%s\n\n%s' "$content" "$layer_content")" ;;
            wrap)
                case "$layer_content" in
                    *'{CORE_TEMPLATE}'*) ;;
                    *) echo "Error: wrap strategy missing {CORE_TEMPLATE} placeholder" >&2; return 1 ;;
                esac
                while [[ "$layer_content" == *'{CORE_TEMPLATE}'* ]]; do
                    local before="${layer_content%%\{CORE_TEMPLATE\}*}"
                    local after="${layer_content#*\{CORE_TEMPLATE\}}"
                    layer_content="${before}${content}${after}"
                done
                content="$layer_content"
                ;;
            *) echo "Error: unknown strategy '$strat'" >&2; return 1 ;;
        esac
    done

    printf '%s' "$content"
    return 0
}

