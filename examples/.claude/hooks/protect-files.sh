#!/bin/bash
# PreToolUse hook: Prevent editing sensitive files
# Exit code 2 = block the action and send reason to Claude

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path (e.g. for tools that don't have one)
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Protected patterns
PROTECTED_PATTERNS=(
  ".env"
  ".env.local"
  ".env.production"
  "credentials.json"
  "service-account"
  "package-lock.json"
  "pnpm-lock.yaml"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$(basename "$FILE_PATH")" == "$pattern"* ]]; then
    echo "Blocked: Cannot edit $FILE_PATH — matches protected pattern '$pattern'. Ask the user for permission first." >&2
    exit 2
  fi
done

exit 0
