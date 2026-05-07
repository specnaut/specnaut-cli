# Security auditor agent memory

Index of persistent notes for the `security-auditor` subagent. Each entry
below points to a single-topic Markdown file in this same directory.

**Format:** `- [Title](file.md) — one-line hook describing why this is worth remembering`

**Keep the index under 200 lines.** Prune entries that are no longer
load-bearing — once a class of finding is fully addressed in code (e.g.
all input validation centralised behind one helper), the memory entry can
be retired.

## When to add an entry here

Add a new memory file when the security auditor discovers something that
should survive across sessions and isn't captured elsewhere:

- **Project-specific threat model** — assets, attackers, abuse paths the
  auditor should weigh more heavily here than in a generic review.
- **Recurring finding patterns** — e.g. "this repo tends to swallow
  errors silently in catch blocks; flag any new occurrence".
- **False-positive patterns** — patterns that LOOK like findings but
  aren't (e.g. internal-only fields that are intentionally exposed
  because a downstream service needs them).
- **Compliance constraints** — data-residency, retention, or
  encryption requirements specific to this project.

## When NOT to add an entry

- Generic OWASP / CWE knowledge → that's already in the auditor's base
  prompt.
- Specific findings on a single PR → those go in the review report.

## Entries

<!-- (this stub starts empty — the security auditor populates it as it learns) -->
