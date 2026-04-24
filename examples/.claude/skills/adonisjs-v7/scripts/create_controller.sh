#!/bin/bash
# Creates an AdonisJS controller with its associated service, repository, and test files.
#
# Usage: bash .claude/skills/adonisjs-v7/scripts/create_controller.sh <Name>
# Example: bash .claude/skills/adonisjs-v7/scripts/create_controller.sh user
#
# This will create:
#   - app/controllers/<name>_controller.ts    (via node ace make:controller)
#   - app/services/<name>_service.ts          (via node ace make:service)
#   - app/repositories/<name>_repository.ts   (manual)
#   - tests/unit/services/<name>_service.spec.ts (manual)

set -e

NAME="$1"

if [ -z "$NAME" ]; then
  echo "❌ Usage: bash $0 <Name>"
  echo "   Example: bash $0 user"
  exit 1
fi

# Convert to snake_case for filenames (e.g., UserProfile -> user_profile)
SNAKE_NAME=$(echo "$NAME" | sed 's/\([A-Z]\)/_\L\1/g' | sed 's/^_//' | tr '[:upper:]' '[:lower:]')

# Convert to PascalCase for class names (e.g., user_profile -> UserProfile)
PASCAL_NAME=$(echo "$SNAKE_NAME" | sed 's/_\([a-z]\)/\U\1/g' | sed 's/^\([a-z]\)/\U\1/')

CONTROLLER_FILE="app/controllers/${SNAKE_NAME}_controller.ts"
SERVICE_FILE="app/services/${SNAKE_NAME}_service.ts"
REPO_FILE="app/repositories/${SNAKE_NAME}_repository.ts"
TEST_FILE="tests/unit/services/${SNAKE_NAME}_service.spec.ts"

echo "🔧 Scaffolding controller stack for: $PASCAL_NAME"
echo ""

# 1. Create the controller via ace command
echo "📦 Creating controller..."
node ace make:controller "$NAME"

# 2. Create the service via ace command
echo "📦 Creating service..."
node ace make:service "$NAME"

# 3. Create the repository manually
mkdir -p "app/repositories"
if [ ! -f "$REPO_FILE" ]; then
  cat > "$REPO_FILE" << REPOEOF
export default class ${PASCAL_NAME}Repository {
  // TODO: Add repository methods (findById, create, update, paginate, etc.)
}
REPOEOF
  echo "✅ Created repository: $REPO_FILE"
else
  echo "⚠️  Repository already exists: $REPO_FILE"
fi

# 4. Create the unit test file
mkdir -p "tests/unit/services"
if [ ! -f "$TEST_FILE" ]; then
  cat > "$TEST_FILE" << TESTEOF
import { test } from '@japa/runner'
import ${PASCAL_NAME}Service from '#services/${SNAKE_NAME}_service'

test.group('${PASCAL_NAME}Service', () => {
  test('should exist', async ({ assert }) => {
    // TODO: Replace with actual test logic
    assert.isTrue(true)
  })
})
TESTEOF
  echo "✅ Created test file: $TEST_FILE"
else
  echo "⚠️  Test file already exists: $TEST_FILE"
fi

echo ""
echo "📁 Files created:"
echo "   Controller:  $CONTROLLER_FILE"
echo "   Service:     $SERVICE_FILE"
echo "   Repository:  $REPO_FILE"
echo "   Test:        $TEST_FILE"
echo ""
echo "Next steps:"
echo "   1. Add repository methods in $REPO_FILE"
echo "   2. Implement business logic in $SERVICE_FILE (inject the repository)"
echo "   3. Wire the controller in $CONTROLLER_FILE (inject the service)"
echo "   4. Write unit tests in $TEST_FILE"
echo "   5. Add routes in start/routes.ts"
echo "   6. Run tests: node ace test --suite unit"
