#!/bin/bash
# Creates an AdonisJS service and its corresponding unit test file.
#
# Usage: bash .claude/skills/adonisjs-v7/scripts/create_service.sh <ServiceName>
# Example: bash .claude/skills/adonisjs-v7/scripts/create_service.sh user

set -e

SERVICE_NAME="$1"

if [ -z "$SERVICE_NAME" ]; then
  echo "❌ Usage: bash $0 <ServiceName>"
  echo "   Example: bash $0 user"
  exit 1
fi

# Convert to snake_case for filenames (e.g., UserProfile -> user_profile)
SNAKE_NAME=$(echo "$SERVICE_NAME" | sed 's/\([A-Z]\)/_\L\1/g' | sed 's/^_//' | tr '[:upper:]' '[:lower:]')

SERVICE_FILE="app/services/${SNAKE_NAME}_service.ts"
TEST_FILE="tests/unit/services/${SNAKE_NAME}_service.spec.ts"

echo "🔧 Creating service: $SERVICE_NAME"

# 1. Create the service via ace command
node ace make:service "$SERVICE_NAME"

# 2. Create the test directory if it doesn't exist
mkdir -p "tests/unit/services"

# 3. Create the unit test file
if [ ! -f "$TEST_FILE" ]; then
  cat > "$TEST_FILE" << 'TESTEOF'
import { test } from '@japa/runner'

test.group('SERVICENAME_PLACEHOLDER Service', () => {
  test('should exist', async ({ assert }) => {
    // TODO: Replace with actual test logic
    assert.isTrue(true)
  })
})
TESTEOF

  # Replace placeholder with actual service name
  sed -i '' "s/SERVICENAME_PLACEHOLDER/$SERVICE_NAME/g" "$TEST_FILE"

  echo "✅ Created test file: $TEST_FILE"
else
  echo "⚠️  Test file already exists: $TEST_FILE"
fi

echo ""
echo "📁 Files created:"
echo "   Service: $SERVICE_FILE"
echo "   Test:    $TEST_FILE"
echo ""
echo "Next steps:"
echo "   1. Implement the service logic in $SERVICE_FILE"
echo "   2. Write unit tests in $TEST_FILE"
echo "   3. Run tests: node ace test --suite unit"
