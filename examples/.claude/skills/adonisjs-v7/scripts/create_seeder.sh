#!/bin/bash
# Creates an AdonisJS seeder.
#
# Usage: bash .claude/skills/adonisjs-v7/scripts/create_seeder.sh <Name>
# Example: bash .claude/skills/adonisjs-v7/scripts/create_seeder.sh project

set -e

NAME="$1"

if [ -z "$NAME" ]; then
  echo "❌ Usage: bash $0 <Name>"
  echo "   Example: bash $0 project"
  exit 1
fi

echo "📦 Creating seeder: $NAME"
node ace make:seeder "$NAME"

echo ""
echo "🎉 Done!"
echo ""
echo "Next steps:"
echo "   1. Implement the run() method with seed data"
echo "   2. Register the seeder in database/seeders/main_seeder.ts"
echo "   3. Run: node ace db:seed"
