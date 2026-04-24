---
name: database-discovery
description: Allows the LLM to understand the topology of the Miximodel database, execute queries inside the Docker Postgres container, discover tables via schema.ts, and execute Redis commands inside the Docker Redis container.
---

# Database Discovery Skill

The databases for this project run **strictly** inside Docker containers named `postgres` and `redis`.
**Never attempt to run `psql` or `redis-cli` directly on the host machine**, as it will result in a "command not found" error or fail to connect.

## How to Connect and Query (PostgreSQL)

To execute an SQL query or a `psql` command (like `\dt`), you MUST use the following script provided by this skill (which automatically handles the docker wrapper):

```bash
bash .claude/skills/database-discovery/scripts/run_postgres_query.sh "SELECT * FROM users LIMIT 1;"
```

Or to list all tables:

```bash
bash .claude/skills/database-discovery/scripts/run_postgres_query.sh "\dt"
```

If for some reason you need to run the Docker command manually, here it is:

```bash
docker exec postgres psql -U admin -d miximodel -c "YOUR SQL QUERY HERE"
```

_(Where `postgres` is the container name, `admin` is the username, and `miximodel` is the database name)._

## How to Connect and Query (Redis)

To inspect caching or pub/sub details, you MUST use the provided Redis script to safely query the Redis container:

```bash
bash .claude/skills/database-discovery/scripts/run_redis_query.sh KEYS "*agenda*"
bash .claude/skills/database-discovery/scripts/run_redis_query.sh GET "bentocache:agenda:6:month:2026-01"
```

If for some reason you need to run the Docker command manually, here it is:

```bash
docker exec redis redis-cli GET "YOUR_KEY"
```

## Understanding Topology and Tables

The project uses **Lucid ORM**. Rather than querying the database blindly, you should first dive into the pivotal file:
`database/schema.ts`

This file is the **single source of truth** synced with the migrations. Each class (e.g., `ArticleSchema`) corresponds to its `snake_case` plural version in the database (e.g., `articles`).
Moreover, this file contains all available columns and their types.

## Security Rules

- It is strictly forbidden to use `psql` or `redis-cli` in **interactive mode** (without the `-c` parameter for Postgres or without passing the command inline to Redis). This would crash/block the LLM's terminal. Always use the `run_postgres_query.sh` and `run_redis_query.sh` scripts.
- Only perform discovery/display queries (`SELECT`, `\d`, `GET`, `KEYS`, etc.). NEVER run `DELETE`, `UPDATE`, `INSERT`, `FLUSHALL` or mutations unless the user explicitly asks you to do so.
