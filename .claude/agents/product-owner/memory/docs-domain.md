---
name: docs domain
description: Specflow's documentation site is hosted at https://specflow.makerlabs.dev (custom domain on top of GitHub Pages). Use this URL when referencing the docs in issue bodies, comments, and AC.
type: reference
---

The Specflow documentation is published at **https://specflow.makerlabs.dev**.

- Hosting: GitHub Pages, deployed via `.github/workflows/static.yml` from
  `docs/llms.md` through `scripts/build-docs.ts` (Deno + `@deno/gfm`).
- Source of truth: a single Markdown file at `docs/llms.md`. Same content
  served as raw Markdown at `https://specflow.makerlabs.dev/llms.txt`
  (llmstxt.org convention).
- The bare `mkrlabs.github.io/specflow/` URL is the GitHub-default origin —
  prefer the custom domain in user-facing copy unless explicitly asked for
  the github.io URL.

**Why:** Custom domain set up on 2026-05-01. The OVH zone for `makerlabs.dev`
carries a CNAME `specflow → mkrlabs.github.io.`; GitHub-side custom-domain
configuration on the repo (`gh api -X PUT repos/mkrlabs/specflow/pages
-f cname=specflow.makerlabs.dev`) and the deploy artifact's `CNAME` file
together pin the custom domain across re-deploys.

**How to apply:**

- When clarifying a docs-related backlog item, write AC and links against
  `https://specflow.makerlabs.dev` rather than the github.io URL.
- When referencing the LLM-readable doc route, use
  `https://specflow.makerlabs.dev/llms.txt`.
- If a future task moves the docs domain (or splits multi-page), update
  this memory file and the canonical link in `docs/llms.md` together.
