---
name: webfetch-cache-after-recent-deploy
description: WebFetch can return stale `specflow.makerlabs.dev/llms.txt` content for several minutes after a docs deploy. Confirm any T1 docs-drift finding by curl-ing directly before recording it.
type: feedback
---

When auditing the public docs in T1, **do not trust a single
`WebFetch https://specflow.makerlabs.dev/llms.txt` response** if there
is any chance the dispatcher has shipped a docs change in the last
~10 minutes. The WebFetch layer caches responses (intermediary CDN +
Claude-side cache), and the cache window can outlast a fresh
GitHub Pages deploy.

**Why:** the qa-tester run on v0.9.2 reported `backlog sync`,
`backlog configure`, and `tasks/backlog.md` as still present in the
live docs and recorded a T1 friction finding. Direct verification
via `curl -fsSL` minutes later showed all three strings absent and
the new `.specflow/backlog.md` + `parent: "#NNN"` content present —
the GitHub Pages `static.yml` deploy had succeeded before the QA
fetch even ran. The agent flagged a regression that did not exist.

**How to apply:**

1. If the dispatch instructions mention a recent docs / `llms.md`
   change, run a cache-busting fetch alongside `WebFetch`:

   ```bash
   curl -fsSL "https://specflow.makerlabs.dev/llms.txt?cb=$(date +%s)" \
     | grep -E "backlog sync|backlog configure|tasks/backlog"
   ```

   Empty output = strings are gone for real. Non-empty = real finding.

2. Cross-check the deploy pipeline before recording a docs finding:

   ```bash
   gh run list --repo mkrlabs/specflow --workflow=static.yml --limit 1 \
     --json status,conclusion,createdAt
   ```

   If the most recent run is `success` AND its `createdAt` is after the
   relevant docs commit, the docs *are* live — any stale content
   `WebFetch` returns is a cache artifact, not a real drift.

3. If both checks confirm the docs are clean, **do not record a T1
   finding** and **note in the report** that WebFetch returned a stale
   response (so the audit trail explains why a previous run flagged
   the issue).

**When to remove this entry:** if the WebFetch cache behaviour is
fixed at the platform level so a fresh deploy is reflected within
seconds, this memory becomes obsolete.
