---
name: dev-only-deno-warning
description: Stderr "exports field should be specified" warning from deno.json — only present in the `deno run` path, never in the compiled binary. Do not flag.
type: feedback
---

When running specflow via `deno run --allow-all src/main.ts <cmd>` (which
is what the test-specflow scripts do), every invocation prints to stderr:

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
