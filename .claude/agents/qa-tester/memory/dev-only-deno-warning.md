---
name: dev-only-deno-warning
description: Stderr "exports field should be specified" warning from deno.json — only present in the `deno run` path, never in the compiled binary. Do not flag.
type: feedback
---

**Note (v2 catalogue):** Since the qa-tester switched to testing the
released binary (`specflow` on PATH, refreshed via T0), this warning
should NOT appear during a normal QA run. It's kept here as a fallback
in case the dispatcher explicitly opts into the dev-time `deno run`
mode (e.g. branch-validation before tagging a release).

When running specflow via `deno run --allow-all src/main.ts <cmd>` (which
the test-specflow `run-init.sh` / `compare-harnesses.sh` scripts still
do for branch-validation), every invocation prints to stderr:

```
Warning "exports" field should be specified when specifying a "name".
    at file:///Users/kevin/Sites/specflow/deno.json
```

**Do not record this as a finding.**

**Why:** It's a Deno workspace metadata warning. `deno.json` declares a
`name` field (used by `deno publish`) without an `exports` field, because
Specflow is a CLI binary, not a library — it has no public Deno API
surface. The warning is benign and only appears in the `deno run`
codepath. End users invoke the compiled binary (`specflow init …`),
where this warning never fires.

**How to apply:** When parsing stdout/stderr from any specflow command,
ignore the line(s) starting with `Warning "exports" field should be
specified` and the immediate `at file:///` continuation. Continue
evaluating the rest of the output normally. List one entry under
"Suppressed by memory" in the report (e.g. `dev-only-deno-warning —
matched 8 times`) so the audit trail stays clean.

**When to remove this entry:** If `deno.json` is restructured to add an
`exports` field (or to drop the `name` field), the warning will stop
firing and this memory can be deleted. The next QA run will then have
clean stderr output by default.
