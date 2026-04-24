#!/bin/bash

# LLM Helper script to query the postgres database running inside Docker
# Usage: bash run_postgres_query.sh "SELECT * FROM users;"

QUERY="$1"

if [ -z "$QUERY" ]; then
  echo "Error: You must provide an SQL query or a psql instruction."
  echo "Usage: bash run_postgres_query.sh \"SELECT * FROM users LIMIT 5;\""
  exit 1
fi

docker exec postgres psql -U admin -d miximodel -c "$QUERY"
