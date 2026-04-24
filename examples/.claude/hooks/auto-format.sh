#!/bin/bash
# PostToolUse hook: Auto-format files after Edit/Write
# Runs Prettier on supported file types silently

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format supported extensions
if echo "$FILE_PATH" | grep -qE '\.(ts|tsx|js|jsx|json|css|md|html)$'; then
  npx prettier --write "$FILE_PATH" 2>/dev/null
fi

exit 0
