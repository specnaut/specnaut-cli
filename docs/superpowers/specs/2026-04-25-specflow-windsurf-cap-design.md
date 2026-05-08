# Windsurf workflow 12k cap fix — design spec

**Goal.** Bring the three oversized command templates under Windsurf's 12 000-char workflow cap, and
add a CI-level guard that prevents future overflow from shipping unnoticed.

**Why.** `specflow init --ai windsurf` currently emits three workflow files that Cascade will
silently truncate at 12 000 chars, breaking the procedural content mid-step. Templates are shared
across all 5 harnesses, so trimming also reduces context bloat for Claude/Cursor/Codex/Gemini.

**Shipping.** Binary `0.5.0-alpha.1 → 0.5.0-alpha.2`, templates `0.6.0 → 0.6.1`. Patch release — bug
fix, no new features.

---

## Templates to trim

| File                                            | Current | Target  | Reduction |
| ----------------------------------------------- | ------- | ------- | --------- |
| `templates/core/commands/specflow-checklist.md` | 19 872  | ≤11 500 | ~42%      |
| `templates/core/commands/specflow-specify.md`   | 16 433  | ≤11 500 | ~30%      |
| `templates/core/commands/specflow-clarify.md`   | 14 224  | ≤11 500 | ~19%      |

The 11 500-char target leaves ~4% headroom under the 12 000-char cap.

The remaining commands stay untouched: `analyze` (10 496), `implement` (10 495), `tasks` (9 237),
`constitution` (8 246), `plan` (6 282), `review` (3 630), `backlog` (3 005). All are below the cap;
the new guard (below) will catch them if any future edit drifts them over.

---

## Trim strategy

**Targets for compression:**

1. **Extension-hook boilerplate.** Each affected file repeats ~30 lines covering the
   `.specflow/extensions.yml` hook discovery contract — optional vs mandatory, condition handling,
   output formatting. The contract is identical across files; condense to a 5-7 line summary that
   points at the pattern without re-spelling every branch.

2. **Verbose explanatory prose.** Sentences that meta-comment on the procedural steps ("Note: this
   clarification workflow is expected to run BEFORE invoking …") often exceed the steps themselves.
   Keep the actionable instruction, drop the framing.

3. **Redundant examples.** Multiple example blocks demonstrating the same pattern. Keep one
   canonical example, drop the rest.

**Strictly preserved (behavior-defining):**

- Frontmatter (`description`, `handoffs`, `scripts` block).
- The `## Outline` and `## Execution steps` sections — these are the workflow's semantic contract.
- Cross-references between commands (`/specflow-plan`, `/specflow-tasks`, etc.).
- Any imperative directives like "you MUST" / "you SHALL" / "STOP HERE" — these are gates the AI
  must respect.

**Verification:** each trim is a per-file commit with a small enough diff to spot-check; the
procedural list count should be unchanged or reduced only when adjacent steps were genuinely
duplicated.

---

## Emit-time guard

Add to `src/infrastructure/harness/windsurf_harness.ts`:

```typescript
/**
 * Windsurf's per-workflow character cap. Cascade silently truncates at this
 * boundary, so we hard-fail at test time when any emitted workflow would exceed
 * it.
 *
 * Documented at https://docs.windsurf.com/windsurf/cascade/workflows
 */
export const WINDSURF_WORKFLOW_MAX_CHARS = 12_000;
```

Add to `tests/infrastructure/harness/windsurf_harness_test.ts`:

```typescript
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { WINDSURF_WORKFLOW_MAX_CHARS } from "../../../src/infrastructure/harness/windsurf_harness.ts";

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

This test exercises the _real_ `CORE_BUNDLE` (not a synthetic sample), so any future template that
drifts oversized fails CI before release.

---

## No runtime check in production

The test catches the regression in CI before merge. Adding a runtime check in
`WindsurfHarness.mapBundle` would only fire on tampered binaries — duplicate cost, no real
protection. The test is enough.

---

## Testing

### New tests

- The single emit-time-cap test above (added to existing
  `tests/infrastructure/harness/windsurf_harness_test.ts`).

### Updated tests

- None. The trimmed templates' content changes the bytes embedded in `src/templates_bundle.ts`, but
  no test asserts on specific template content. The 9 existing tests across all harnesses continue
  to pass because they assert destination paths and structural shape, not body bytes.

### Expected count

Current 272 + 1 (cap test) = **273**.

### Verification beyond the suite

End-to-end:

```bash
rm -rf /tmp/sf-cap-check && mkdir /tmp/sf-cap-check
cd /tmp/sf-cap-check
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai windsurf
for f in demo/.windsurf/workflows/*.md; do
  size=$(wc -c < "$f")
  if [ "$size" -gt 12000 ]; then
    echo "FAIL: $f is $size chars (>12000)"
  fi
done
```

No `FAIL:` lines should print. Then verify the trimmed `clarify`/`specify`/ `checklist` workflows
still describe the same procedural shape — read each and confirm it has an `## Outline`, an
`## Execution steps` section, and the same cross-references to other commands.

---

## Out of scope

- Trimming the near-cap files (`analyze`, `implement`, `tasks`) preventatively.
- Adding char-count caps for other harnesses (Cursor, Codex, Gemini have no documented limits).
- Restructuring command content into chunked sub-workflows or moving prose into `AGENTS.md` for
  Windsurf only.
- Smoke-testing the trimmed prompts on a real LLM.

---

## Release plan

1. Branch `fix/windsurf-cap` from main.
2. Add the constant + test first (Task 1) — confirm it fails on master, marking the regression.
3. Trim each oversized template in its own commit (Tasks 2–4) — small diffs, easy review.
4. Verify the cap test passes; full suite green at 273.
5. Squash-merge to main.
6. Bump binary `0.5.0-alpha.1 → 0.5.0-alpha.2`, templates `0.6.0 → 0.6.1`; tag `v0.5.0-alpha.2`;
   push main + tag.
