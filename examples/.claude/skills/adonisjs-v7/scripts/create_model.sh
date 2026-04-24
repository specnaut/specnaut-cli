#!/bin/bash
# Creates an AdonisJS model.
#
# Usage: bash .claude/skills/adonisjs-v7/scripts/create_model.sh <ModelName>
# Example: bash .claude/skills/adonisjs-v7/scripts/create_model.sh Project

set -e

MODEL_NAME="$1"

if [ -z "$MODEL_NAME" ]; then
  echo "❌ Usage: bash $0 <ModelName>"
  echo "   Example: bash $0 Project"
  exit 1
fi

echo "📦 Creating model: $MODEL_NAME"
node ace make:model "$MODEL_NAME"

echo ""
echo "🎉 Done!"
echo ""
echo "Next steps:"
echo "   1. Add @column() decorators for each database column"
echo "   2. Define relationships (@hasMany, @belongsTo, etc.)"
echo "   3. Add computed properties if needed"
