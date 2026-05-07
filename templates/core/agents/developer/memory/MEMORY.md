# Developer agent memory

Index of persistent notes for the `developer` subagent. Each entry below
points to a single-topic Markdown file in this same directory.

**Format:** `- [Title](file.md) — one-line hook describing why this is worth remembering`

**Keep the index under 200 lines.** Prune entries that are no longer
load-bearing — once a workaround is captured in code or a fix lands
upstream, the memory entry can be retired.

## When to add an entry here

Add a new memory file when the developer discovers something that should
survive across sessions and isn't captured elsewhere:

- Codebase gotchas ("file X has a load-bearing side effect at import time;
  do not move it").
- Failed approaches ("we tried Y to solve Z and it didn't work because…").
- Library quirks specific to the version this project pins.
- Build / test environment specifics ("Deno 2.x emits a benign warning
  about exports field; ignore in `deno run`, not in compiled binary").

## When NOT to add an entry

- Architecture decisions → those go in `AGENTS.md` or `.specflow/memory/constitution.md`.
- One-off bug fixes that are captured in the commit message → no memory
  needed.
- Anything the developer can re-derive by reading the current code.

## Entries

<!-- (this stub starts empty — the developer populates it as it learns) -->
