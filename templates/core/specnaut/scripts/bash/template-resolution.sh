#!/usr/bin/env bash
# Template resolution for the spec scripts — the override → preset → extension →
# core stack. Sourced by `common.sh`.

# The enabled preset ids of a `.registry`, lowest priority number first (the
# highest precedence), and the registry's state as the status (cli#757), the
# same three as Get-RegistryPresetIds: 0 parsed (a JSON object whose `presets`
# is absent or an object: exactly its enabled presets, possibly none), 3 blank
# (read as absent), 1 malformed (anything else). The ids are written as bytes
# with `\n`: a Windows python3 would end each with `\r\n` in text mode.
_preset_ids_by_priority() {
    SPECNAUT_REGISTRY="$1" python3 -I -c "
import json, sys, os
try:
    with open(os.environ['SPECNAUT_REGISTRY'], encoding='utf-8-sig') as f:
        text = f.read()
    if not text.strip():
        sys.exit(3)
    data = json.loads(text)
    presets = data.get('presets', {}) if isinstance(data, dict) else None
    if not isinstance(presets, dict):
        sys.exit(1)
    meta = lambda m: m if isinstance(m, dict) else {'enabled': False}
    ids = [p for p, m in sorted(presets.items(), key=lambda x: meta(x[1]).get('priority', 10))
           if meta(m).get('enabled', True) is not False]
    sys.stdout.buffer.write(''.join(p + chr(10) for p in ids).encode('utf-8'))
except Exception:
    sys.exit(1)
" 2>/dev/null && return 0
    local rc=$?
    # The sentence Get-RegistryPresetIds prints (cli#754), fixed text: python's
    # message quotes the file. Once per run because an entry script resolves one
    # template; a flag here would sit in the caller's `$( … )` and be lost anyway.
    [ "$rc" = 3 ] || echo "WARNING: .specnaut/presets/.registry could not be parsed; using alphabetical preset order" >&2
    return "$rc"
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

    # Priority 2: Installed presets. A registry that parses decides, even when it
    # enables none (cli#757); absent, blank or malformed (or no python3 to read
    # it), alphabetical directory order. The read sits in the condition so set -e
    # does not abort the function on a registry python3 cannot parse.
    local presets_dir="$repo_root/.specnaut/presets"
    if [ -d "$presets_dir" ]; then
        local preset_ids="" state=3
        if [ -f "$presets_dir/.registry" ] && command -v python3 >/dev/null 2>&1; then
            preset_ids=$(_preset_ids_by_priority "$presets_dir/.registry") && state=0 || state=$?
        fi
        if [ "$state" = 0 ]; then
            while IFS= read -r preset_id; do
                [ -n "$preset_id" ] || continue
                local candidate="$presets_dir/$preset_id/templates/${template_name}.md"
                [ -f "$candidate" ] && echo "$candidate" && return 0
            done <<< "$preset_ids"
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
