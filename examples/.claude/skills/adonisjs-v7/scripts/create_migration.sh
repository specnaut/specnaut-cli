#!/bin/bash
# Creates an AdonisJS migration (and optionally the model).
#
# Usage:
#   bash .claude/skills/adonisjs-v7/scripts/create_migration.sh <table_name>
#   bash .claude/skills/adonisjs-v7/scripts/create_migration.sh <table_name> --with-model
#
# Examples:
#   bash .claude/skills/adonisjs-v7/scripts/create_migration.sh projects
#   bash .claude/skills/adonisjs-v7/scripts/create_migration.sh bookings --with-model

set -e

TABLE_NAME="$1"
WITH_MODEL="$2"

if [ -z "$TABLE_NAME" ]; then
  echo "❌ Usage: bash $0 <table_name> [--with-model]"
  echo "   Example: bash $0 projects"
  echo "   Example: bash $0 bookings --with-model"
  exit 1
fi

echo "🔧 Creating migration for: $TABLE_NAME"
echo ""

if [ "$WITH_MODEL" = "--with-model" ]; then
  echo "📦 Creating migration + model..."
  node ace make:migration "$TABLE_NAME" -m
else
  echo "📦 Creating migration..."
  node ace make:migration "$TABLE_NAME"
fi

echo ""
echo "🎉 Done!"
echo ""
echo "Next steps:"
echo "   1. Define columns in the migration's up() method"
echo "   2. Ensure down() reverses up() cleanly"
echo "   3. Run: node ace migration:run"
