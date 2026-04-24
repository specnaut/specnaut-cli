#!/bin/bash
# Installs a new ShadCN UI component and updates the React skill
# with the newly added primitive.
#
# Usage: bash .claude/skills/react/scripts/add_component.sh <component-name> [component-name2 ...]
# Example: bash .claude/skills/react/scripts/add_component.sh toast
# Example: bash .claude/skills/react/scripts/add_component.sh toast drawer collapsible

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "$1" ]; then
  echo "❌ Usage: bash $0 <component-name> [...]"
  echo "   Example: bash $0 toast"
  echo "   Example: bash $0 toast drawer collapsible"
  exit 1
fi

COMPONENTS="$*"
SKILL_FILE="$SKILL_DIR/SKILL.md"
UI_DIR="inertia/components/ui"

echo "📦 Installing ShadCN component(s): $COMPONENTS"
echo ""

# 1. Install the component(s) via shadcn CLI
npx shadcn@latest add $COMPONENTS

echo ""

# 2. Regenerate the primitives table in SKILL.md
if [ -f "$SKILL_FILE" ]; then
  echo "📝 Updating primitives table in $SKILL_FILE..."

  # Build the new table from all .tsx files in the ui directory
  NEW_TABLE="Currently installed primitives:\n\n| Component      | Path                              |\n| :------------- | :-------------------------------- |"

  for file in $(ls "$UI_DIR"/*.tsx 2>/dev/null | sort); do
    basename=$(basename "$file" .tsx)

    # Convert kebab-case filename to PascalCase for display
    # e.g., alert-dialog -> AlertDialog, scroll-area -> ScrollArea
    pascal_name=$(echo "$basename" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1' | sed 's/ //g')

    # Pad component name and path for table alignment
    printf -v row "\n| %-14s | \`@/components/ui/%-16s\` |" "$pascal_name" "$basename"
    NEW_TABLE+="$row"
  done

  # Replace the table block in SKILL.md
  # We match from "Currently installed primitives:" to the empty line before "If a needed primitive"
  python3 -c "
import re, sys

with open('$SKILL_FILE', 'r') as f:
    content = f.read()

# Match the old table block
pattern = r'Currently installed primitives:.*?\n\n(?=If a needed primitive)'
replacement = '''$(echo -e "$NEW_TABLE")

'''

result = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('$SKILL_FILE', 'w') as f:
    f.write(result)
"

  echo "✅ Primitives table updated!"
else
  echo "⚠️  Skill file not found at $SKILL_FILE — skipping table update."
fi

echo ""
echo "🎉 Done! Component(s) installed: $COMPONENTS"
echo ""

# 3. List what was created
for comp in $COMPONENTS; do
  COMP_FILE="$UI_DIR/$comp.tsx"
  if [ -f "$COMP_FILE" ]; then
    echo "   ✅ $COMP_FILE"
  else
    echo "   ⚠️  $COMP_FILE not found (may have a different filename)"
  fi
done
