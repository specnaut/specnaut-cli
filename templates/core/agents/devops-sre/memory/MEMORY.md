# DevOps / SRE agent memory

Index of persistent notes for the `devops-sre` subagent. Each entry below
points to a single-topic Markdown file in this same directory.

**Format:** `- [Title](file.md) — one-line hook describing why this is worth remembering`

**Keep the index under 200 lines.** Prune entries that are no longer
load-bearing — once an incident is post-mortemed and the fix is in IaC,
the memory entry can be retired.

## When to add an entry here

Add a new memory file when the devops-sre agent discovers something that
should survive across sessions and isn't captured elsewhere:

- **Pipeline quirks** — flaky CI steps, runner availability windows,
  rate-limit gotchas with cloud providers.
- **Deployment gotchas** — order-of-operations issues ("must apply X
  migration BEFORE rolling out service Y"), dual-region propagation lags.
- **Secret / credential locations** — which secrets live where, who
  rotates them, what breaks when they expire.
- **Observability blind spots** — metrics or logs that don't capture an
  important class of incident; pointers to the dashboards that do.

## When NOT to add an entry

- IaC / pipeline definitions → those live in the actual config files.
- Architecture choices → those go in `AGENTS.md` or
  `.specflow/memory/constitution.md`.
- One-off incidents that are fully resolved with no recurring risk → no
  memory needed.

## Entries

<!-- (this stub starts empty — the devops-sre populates it as it learns) -->
