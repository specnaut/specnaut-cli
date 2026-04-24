---
name: inertia-v3-expert
description: Expert knowledge of Inertia JS V3, including full local documentation, breaking changes, optimistic updates, and advanced data prefetching.
---

# Inertia JS V3 Expert Skill

This skill contains the complete local documentation for **Inertia JS V3**. The user specifically requested this skill to avoid blind guessing when dealing with brand new V3 features like Lazy loading, Polling, Optimistic Updates, and Persistent History caching.

## Documentation Directory

The full Inertia V3 documentation has been downloaded as Markdown files to:
`./docs/`

If you are dealing with a specific Inertia V3 feature or bug, **always use the `view_file` or `grep_search` tools to read the actual documentation files in `./docs/`** before attempting a solution.

### Available Documentation Concepts

1. **Routing and Visits:** `routing.md`, `links.md`, `manual-visits.md`, `instant-visits.md`
2. **Data & Props:** `shared-data.md`, `deferred-props.md`, `merging-props.md`, `polling.md`, `prefetching.md`
3. **Optimistic Updates & State:** `optimistic-updates.md`, `remembering-state.md`, `history-encryption.md`
4. **Setup & Architecture:** `client-side-setup.md`, `server-side-setup.md`, `how-it-works.md`

## Why this Skill Exists

Inertia V3 introduced numerous breaking changes and advanced frontend architecture improvements (like `Deferred Props`, `Optimistic Updates`, and different history caching behaviors) that might conflict with traditional AdonisJS patterns or older V2 assumptions.

### Example V3 Breaking Change discovered

Inertia V3 stopped reading its initial page payload from `<div id="app" data-page="...">`. It now strictly requires the server to render a `<script data-page="app" type="application/json">` injection.

### Usage Protocol

1. **Identify the Inertia V3 concept** the user is asking about (e.g. "Optimistic Updates for the Like button").
2. **Search the `./docs/`** folder inside this skill to read the exact syntax.
3. **Verify the implementation** in the user's React / Adonis code strictly follows the guidelines outlined in the downloaded documentation.
4. Use `scripts/fetch_docs.sh` to refresh or pull new documentation if paths change.
