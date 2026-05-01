---
name: github-labels
description: Available labels in mkrlabs/specflow — only use these when creating issues
type: reference
---

The repo has only the default GitHub label set. When creating issues, restrict to:
`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`.

**Why:** Attempting to assign non-existent labels (e.g., `ux`, `docs`, `friction`) causes `gh issue create` to fail with a label-not-found error. Discovered on 2026-05-01 while creating issues #15–#20.

**How to apply:** Before assigning labels, stay within this list. Do not invent new label slugs. If a label is missing and seems important, surface it in the final report so Kevin can create it — do not block issue creation.
