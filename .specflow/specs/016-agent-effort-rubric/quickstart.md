# Quickstart — per-agent effort rubric

## Build & test

```bash
cd apps/specflow-cli
deno task bundle
deno task test     # bundle + agent_effort_test (every agent has valid effort; no sonnet+xhigh)
```

## Manual verification

```bash
# every agent declares effort
for f in templates/core/agents/*.md; do grep -q "^effort:" "$f" || echo "MISSING: $f"; done
# no sonnet agent carries xhigh
for f in templates/core/agents/*.md; do
  m=$(awk -F': ' '/^model:/{print $2}' "$f"); e=$(awk -F': ' '/^effort:/{print $2}' "$f")
  [ "$m" = sonnet ] && [ "$e" = xhigh ] && echo "BAD: $f sonnet+xhigh"
done
test -f templates/core/agents/README.md   # rubric doc present
```

## Success signals

- `deno task test` green incl. `agent_effort_test`.
- All 15 agents carry a valid `effort:`; xhigh only on the three opus agents.
- README documents the four tiers, members, rationale, and the Opus-only caveat.
- `specflow init`/`upgrade` deliver the tuned agents + README.
