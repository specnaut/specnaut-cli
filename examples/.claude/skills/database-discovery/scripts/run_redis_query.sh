#!/bin/bash

# LLM Helper script to query the redis database running inside Docker
# Usage: bash run_redis_query.sh "KEYS *" or bash run_redis_query.sh "GET mykey"

if [ -z "$1" ]; then
  echo "Error: You must provide a Redis command."
  echo "Usage: bash run_redis_query.sh GET \"bentocache:agenda:6:month:2026-01\""
  echo "       bash run_redis_query.sh KEYS \"*agenda*\""
  exit 1
fi

# Execute command with --raw to avoid escape characters
OUTPUT=$(docker exec redis redis-cli --raw "$@")

# Format output as JSON if it is a valid JSON string (using the local Node.js)
export OUTPUT
node -e "
try {
  const val = process.env.OUTPUT;
  if (!val) {
    console.log(val);
    process.exit(0);
  }
  const parsed = JSON.parse(val);
  console.log(JSON.stringify(parsed, null, 2));
} catch(e) {
  // Not JSON, just print the raw output
  console.log(process.env.OUTPUT);
}
"
