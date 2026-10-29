---
name: backlog-reference-contract
description: Defines how a backlog item is named when shown to the user — number, title, and a backend-resolved link. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: an output-format contract preloaded by entry points that already read the constitution first
---

# backlog-reference-contract

This skill defines the **backlog reference** — the way a task, user story, or
epic is written whenever it is shown to the user. It exists so the rule is
stated **once**. Every agent, skill, phase, command, and project document that
mentions an item points here; none of them restates it.

A bare `#42` is opaque. The reader has to leave the conversation and look the
item up in the tracker just to know what the sentence is about — and worse, to
decide whether to approve an action taken on it. The number identifies the item
to the tracker; the title identifies it to the human.

## Format

```text
[#<number> — <title>](<url>)      link resolves
#<number> — <title>               no url resolvable
#<number>                         title unavailable — last resort only
```

Examples:

```text
[#42 — Add pagination to the export endpoint](https://github.com/acme/my-app/issues/42)
#42 — Add pagination to the export endpoint
```

## Rules

- **Never a number alone** when the title is available. The pair is the unit.
- **Title verbatim.** Do not paraphrase, re-case, or summarise it. Truncate only
  past 80 characters, with a trailing `…`.
- **Link the whole pair**, not just the number — the title is the click target a
  reader actually aims at.
- **Applies to every rendering**: prose, tables, lists, status blocks, commit
  bodies, and prompts that ask the user to approve something. A confirmation
  prompt naming a bare number is the worst case, because the user is being asked
  to authorise an action on an item they cannot identify.
- **One reference per mention is enough.** In a table, the reference belongs in
  one column; do not repeat the number in a neighbouring one.
- **Never fabricate a URL.** If it cannot be resolved from configuration, fall
  back — see below. A wrong link is worse than no link.

## Resolving the URL

The backlog backend is whatever the project configured.
`.specnaut/scripts/backlog/_config.sh` exports the coordinates and an
`item_url <number>` helper — **use that helper**; do not assemble URLs by hand
and do not re-derive them per surface.

That path is the same under every harness and every backend. Only the selected
backend's scripts are installed, and they are installed flat — there is no
per-backend subdirectory to substitute into, and nothing to look up.

| Backend | Resolves to | From |
|---|---|---|
| `github` | `https://github.com/<repo>/issues/<n>` | `repo` |
| `gitlab` | `<host>/<path>/-/issues/<n>` | `host` + `project_id` |
| `local` | relative path `.specnaut/backlog/<n>-<slug>.md` | the task file on disk |
| `cloud` | *no link* — see below | — |

**GitLab `project_id` is dual-form.** It is either a numeric id or a
`group/project` path. The path form links directly. The numeric form is resolved
to a path once via `glab api projects/<id>` → `path_with_namespace`; if that
call fails, degrade rather than guess.

**Cloud has no browser URL today** and is deliberately deferred. Its config
carries an API base and a project key, and the task payloads expose no web
address. So cloud takes the no-link fallback: number and title, no link. This is
defined behaviour, not an unimplemented branch.

> **Never construct a browser URL from the API host.** An API base is not a web
> origin; the guess is wrong more often than right, and a wrong link sends the
> user somewhere that does not exist. When the Cloud side ships a web address as
> a field on the task payload, this branch renders it — no change to the shape
> above.

## Degradation

Resolution is best-effort and must never block. Walk down until something works:

1. `[#<n> — <title>](<url>)` — full reference.
2. `#<n> — <title>` — URL unresolvable: unknown backend, missing or half-filled
   config, a backend with no web address, or a failed lookup.
3. `#<n>` — the title itself is unavailable. Last resort.

Never raise an error, never stall a workflow, and never omit the reference
entirely because it could not be made perfect. A degraded reference is still
more useful than none.
