# QA tester agent memory

Index of persistent notes for the `qa-tester` subagent. Each entry below
points to a single-topic Markdown file in this same directory.

**Format:** `- [Title](file.md) — one-line hook describing why this is worth remembering`

**Keep the index under 200 lines.** Prune entries that are no longer
load-bearing — once a flaky test is fixed or a known-good finding is filed
as a ticket, the memory entry can be retired.

## When to add an entry here

Add a new memory file when the QA tester discovers something that should
survive across sessions and isn't captured elsewhere:

- **Tracked findings** — items already filed as tickets that the tester
  should NOT re-flag in subsequent runs (until the ticket closes and the
  fix needs verification).
- **Flaky tests** — ones that fail intermittently for known
  environment-specific reasons; record the trigger and the workaround.
- **Test fixture quirks** — load-bearing setup details that aren't obvious
  from reading the test code.
- **Caching caveats** — e.g. CDNs, package managers, or third-party APIs
  whose responses can be stale right after a deploy.

## When NOT to add an entry

- Test failures that map directly to a real bug → file a ticket via the
  PO, not a memory entry.
- One-off transient errors that resolve on retry → no memory needed.

## Entries

<!-- (this stub starts empty — the QA tester populates it as it learns) -->
