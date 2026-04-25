# Specflow Windsurf cap fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim three oversized command templates so every Windsurf workflow fits under Cascade's 12
000-char cap, and add a CI-level guard that prevents future overflow from shipping.

**Architecture:** Editorial trim of `specflow.checklist.md`, `specflow.specify.md`, and
`specflow.clarify.md`, one per task — same content semantics, less verbose prose. Then a
`WINDSURF_WORKFLOW_MAX_CHARS` constant and a single test that walks the real `CORE_BUNDLE` through
`WindsurfHarness.mapBundle()` and asserts every emitted workflow is within the cap.

**Tech Stack:** Deno 2 + TypeScript. No new dependencies. Templates use the existing manifest/bundle
pipeline; trimming is a content edit only.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-windsurf-cap-design.md`

---

## File Structure (changes)

```
templates/core/commands/
├── specflow.checklist.md                            MODIFY (19 872 → ≤11 500 chars)
├── specflow.specify.md                              MODIFY (16 433 → ≤11 500 chars)
└── specflow.clarify.md                              MODIFY (14 224 → ≤11 500 chars)

src/
└── infrastructure/harness/windsurf_harness.ts       MODIFY (add WINDSURF_WORKFLOW_MAX_CHARS)

tests/
└── infrastructure/harness/windsurf_harness_test.ts  MODIFY (+1 cap test)
```

Expected net test count: 272 → 273.

---

## Tasks 1–3 (trims): shared trim strategy

These three editorial-trim tasks share the same strategy. Each task targets one file and is a
separate commit so the diffs stay reviewable.

**Preserve verbatim** in every file:

- The YAML frontmatter (`description`, `handoffs`, `scripts`).
- Section headings (`## Outline`, `## Execution steps`, etc.) and their procedural step lists. The
  semantic contract lives there.
- Cross-references to other commands (`/specflow-plan`, `/specflow-tasks`, etc.).
- Imperative directives ("you MUST", "you SHALL", "STOP HERE", "EXECUTE_COMMAND").

**Compression targets:**

1. **`## Pre-Execution Checks` extension-hook boilerplate.** Every affected file has a ~30-line
   block describing the `.specflow/extensions.yml` hook discovery contract — optional vs mandatory,
   condition handling, output formatting. Condense to 5–8 lines per the worked example below.

2. **Verbose meta-prose around procedural steps.** Sentences that explain _about_ the steps rather
   than perform them. Keep the actionable instruction; drop the framing.

3. **Redundant examples.** When several example blocks demonstrate the same pattern, keep one
   canonical example and drop the rest.

**Worked example — the extension-hook block compression:**

````
BEFORE (~30 lines, in clarify.md as `before_clarify`, in specify.md as
`before_specify`, in checklist.md as `before_checklist`):

**Check for extension hooks (before clarification)**:
- Check if `.specflow/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_clarify` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
- If no hooks are registered or `.specflow/extensions.yml` does not exist, skip silently
````

```
AFTER (~7 lines):

**Check extension hooks (`hooks.before_clarify` in `.specflow/extensions.yml`)**:
Skip silently if the file is absent or unparseable. For each enabled entry
(treat missing `enabled` as `true`) without a non-empty `condition`, emit:

- `optional: true` → `## Extension Hooks` block with `**Optional Pre-Hook**: {extension}`,
  command, description, and prompt.
- `optional: false` → `## Extension Hooks` block with `**Automatic Pre-Hook**: {extension}`,
  `EXECUTE_COMMAND: {command}`, and wait for the result before proceeding.

Hooks with non-empty `condition` are deferred to the HookExecutor.
```

That single compression already saves ~25 lines per file. Apply equivalent compressions elsewhere
when verbose framing is doing the same job.

**Verification per task:**

```bash
deno eval --allow-read 'console.log((await Deno.readTextFile("templates/core/commands/specflow.<name>.md")).length)'
```

The output must be `≤ 11500`. If it's higher, keep trimming.

After verification, run the full suite to confirm no other test broke:

```bash
deno task test
# expected: ok | 272 passed | 0 failed (until Task 4, which adds the cap test)
```

---

## Task 1: Trim `specflow.checklist.md` (19 872 → ≤11 500)

**Files:**

- Modify: `templates/core/commands/specflow.checklist.md`

The file has 7 sections: `## Checklist Purpose: "Unit Tests for English"`, `## User Input`,
`## Pre-Execution Checks`, `## Execution Steps`, `## Example Checklist Types & Sample Items`,
`## Anti-Examples: What NOT To Do`, `## Post-Execution Checks`.

- [ ] **Step 1: Read the current file**

```bash
cd /Users/kevin/Sites/specflow
cat templates/core/commands/specflow.checklist.md | wc -c
# expected: 19872 (before trim)
```

- [ ] **Step 2: Apply the trim**

Edit `templates/core/commands/specflow.checklist.md` per the shared strategy above. Specifically:

- Compress `## Pre-Execution Checks` extension-hook block per the worked example.
- `## Example Checklist Types & Sample Items` and `## Anti-Examples: What NOT
  To Do` are likely
  the largest sections; keep their structural shape but reduce each sub-example to its essential
  bullet — drop multi-paragraph expansions.
- `## Execution Steps` is behavior-defining: preserve every numbered step.
- Frontmatter, section headings, and cross-references stay intact.

- [ ] **Step 3: Verify size**

```bash
deno eval --allow-read 'console.log((await Deno.readTextFile("templates/core/commands/specflow.checklist.md")).length)'
```

Expected: `≤ 11500`.

If the count is above 11 500, keep trimming. Use the same strategy: identify verbose framing,
redundant examples, repeated explanations.

- [ ] **Step 4: Run the full suite**

```bash
deno task test
```

Expected: `ok | 272 passed | 0 failed`. Trimming changes embedded bytes in `src/templates_bundle.ts`
but no test asserts on specific template content, so the count and pass-state stay unchanged.

- [ ] **Step 5: Commit**

```bash
git add templates/core/commands/specflow.checklist.md src/templates_bundle.ts
git commit -m "refactor(templates): trim specflow.checklist.md under Windsurf 12k cap"
```

---

## Task 2: Trim `specflow.specify.md` (16 433 → ≤11 500)

**Files:**

- Modify: `templates/core/commands/specflow.specify.md`

The file has 4 sections: `## User Input`, `## Pre-Execution Checks`, `## Outline`,
`## Quick Guidelines`.

- [ ] **Step 1: Read the current file**

```bash
cd /Users/kevin/Sites/specflow
cat templates/core/commands/specflow.specify.md | wc -c
# expected: 16433 (before trim)
```

- [ ] **Step 2: Apply the trim**

Edit `templates/core/commands/specflow.specify.md` per the shared strategy:

- Compress `## Pre-Execution Checks` extension-hook block per the worked example.
- `## Quick Guidelines` typically carries verbose explanatory prose that meta- comments on the
  workflow's behavior; keep the canonical guidelines as concise bullets and drop multi-sentence
  elaborations.
- `## Outline` is behavior-defining: preserve the procedural steps and any imperative directives.
  Compress only the meta-framing around them.
- Frontmatter, section headings, cross-references stay intact.

- [ ] **Step 3: Verify size**

```bash
deno eval --allow-read 'console.log((await Deno.readTextFile("templates/core/commands/specflow.specify.md")).length)'
```

Expected: `≤ 11500`.

- [ ] **Step 4: Run the full suite**

```bash
deno task test
```

Expected: `ok | 272 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add templates/core/commands/specflow.specify.md src/templates_bundle.ts
git commit -m "refactor(templates): trim specflow.specify.md under Windsurf 12k cap"
```

---

## Task 3: Trim `specflow.clarify.md` (14 224 → ≤11 500)

**Files:**

- Modify: `templates/core/commands/specflow.clarify.md`

The file has 4 sections: `## User Input`, `## Pre-Execution Checks`, `## Outline`,
`## Post-Execution Checks`.

- [ ] **Step 1: Read the current file**

```bash
cd /Users/kevin/Sites/specflow
cat templates/core/commands/specflow.clarify.md | wc -c
# expected: 14224 (before trim)
```

- [ ] **Step 2: Apply the trim**

Edit `templates/core/commands/specflow.clarify.md` per the shared strategy:

- Compress `## Pre-Execution Checks` extension-hook block per the worked example.
- `## Outline` typically carries multi-paragraph framing for each step; keep the procedural list,
  drop the surrounding meta-commentary.
- `## Post-Execution Checks` likely contains verbose verification narration; keep the actual checks
  as bullets, drop expansions.
- Frontmatter, section headings, cross-references, and imperative directives ("BEFORE invoking",
  "STOP", etc.) stay intact.

- [ ] **Step 3: Verify size**

```bash
deno eval --allow-read 'console.log((await Deno.readTextFile("templates/core/commands/specflow.clarify.md")).length)'
```

Expected: `≤ 11500`.

This file needs only ~19% reduction, so individual-line cuts will likely be enough — no need to
remove whole sub-sections.

- [ ] **Step 4: Run the full suite**

```bash
deno task test
```

Expected: `ok | 272 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add templates/core/commands/specflow.clarify.md src/templates_bundle.ts
git commit -m "refactor(templates): trim specflow.clarify.md under Windsurf 12k cap"
```

---

## Task 4: Add the cap constant + CI guard test

**Files:**

- Modify: `src/infrastructure/harness/windsurf_harness.ts` (export new constant)
- Modify: `tests/infrastructure/harness/windsurf_harness_test.ts` (append 1 test)

- [ ] **Step 1: Add the constant in `src/infrastructure/harness/windsurf_harness.ts`**

At the TOP of the file (after the existing `import` lines, before `function destinationFor`), add:

```typescript
/**
 * Windsurf's per-workflow character cap. Cascade silently truncates at this
 * boundary, so we hard-fail at test time when any emitted workflow would
 * exceed it.
 *
 * Documented at https://docs.windsurf.com/windsurf/cascade/workflows
 */
export const WINDSURF_WORKFLOW_MAX_CHARS = 12_000;
```

The rest of the file (`destinationFor`, `WindsurfHarness` class) stays unchanged.

- [ ] **Step 2: Append the cap test to `tests/infrastructure/harness/windsurf_harness_test.ts`**

The current test file imports `WindsurfHarness` from the harness module and defines a `SAMPLE`
`CoreBundle`. Add the new test using the _real_ `CORE_BUNDLE` (not `SAMPLE`) so it exercises every
shipped template.

At the top of the file, ADD these two imports next to the existing imports:

```typescript
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { WINDSURF_WORKFLOW_MAX_CHARS } from "../../../src/infrastructure/harness/windsurf_harness.ts";
```

(Keep all existing imports — `assert`, `assertEquals`, `WindsurfHarness`, `CoreBundle`.)

At the END of the file, append:

```typescript
Deno.test("WindsurfHarness emits no workflow exceeding the Cascade cap", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  for (const [path, file] of Object.entries(mapped)) {
    if (!path.startsWith(".windsurf/workflows/")) continue;
    assert(
      file.content.length <= WINDSURF_WORKFLOW_MAX_CHARS,
      `${path} exceeds ${WINDSURF_WORKFLOW_MAX_CHARS} chars: ${file.content.length}`,
    );
  }
});
```

- [ ] **Step 3: Run the focused test — expect pass**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/windsurf_harness_test.ts
```

Expected: `ok | 9 passed | 0 failed` (8 existing + 1 new).

If the new test fails listing one of the trimmed files, the trim from Tasks 1–3 didn't go far
enough. Read the failure message — it prints the offending path and its size — and trim that file
further before continuing.

- [ ] **Step 4: Run the full suite**

```bash
deno task test
```

Expected: `ok | 273 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/harness/windsurf_harness.ts \
        tests/infrastructure/harness/windsurf_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(windsurf): hard-fail when any workflow exceeds the 12k Cascade cap"
```

---

## Wrap-up

At the end of Task 4 the repo has:

- The 3 oversized command templates trimmed to ≤ 11 500 chars each (with ~4% headroom under the
  Windsurf 12 000-char cap).
- `WINDSURF_WORKFLOW_MAX_CHARS = 12_000` exported from the Windsurf adapter.
- A new test that walks every shipped command/backlog-cmd through `WindsurfHarness.mapBundle()` and
  fails CI if any output exceeds the cap.
- 273 tests green.

### End-to-end validation

```bash
rm -rf /tmp/sf-cap && mkdir /tmp/sf-cap
cd /tmp/sf-cap
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai windsurf
for f in demo/.windsurf/workflows/*.md; do
  size=$(wc -c < "$f")
  if [ "$size" -gt 12000 ]; then
    echo "FAIL: $f is $size chars (>12000)"
  fi
done
# expected: no FAIL lines
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-cap
```

Then spot-check the trimmed `clarify` / `specify` / `checklist` workflows still have the structural
sections they need — `## Outline` (or `## Execution Steps`), the same cross-references, and any
imperative directives.

### Release (after merge)

- Squash-merge `fix/windsurf-cap` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.5.0-alpha.1` to `0.5.0-alpha.2`.
- Bump `templates/manifest.json` `version` from `0.6.0` to `0.6.1`; re-run `deno task bundle`.
- Commit, tag `v0.5.0-alpha.2`, push main + tag.
