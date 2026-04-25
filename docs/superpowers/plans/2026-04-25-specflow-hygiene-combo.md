# Specflow hygiene combo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small fixes from prior reviews bundled into one short brick: swap
`frontmatterField`'s regex for `parseYaml`, replace an inline literal union with
`Record<KnownHarness, string>`, and add per-directory file-count assertions to all 5
`init_<harness>_test.ts` files.

**Architecture:** Three independent, file-local edits. No new modules, no API changes, no template
content edits. Each task is a standalone commit.

**Tech Stack:** Deno 2 + TypeScript. `@std/yaml` already in the import map. No new dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-hygiene-combo-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/frontmatter.ts            MODIFY (regex → parseYaml)
└── infrastructure/fs_project_inspector.ts           MODIFY (Record<KnownHarness, string>)

tests/
├── infrastructure/harness/frontmatter_test.ts       MODIFY (+2 tests)
└── integration/
    ├── init_test.ts                                 MODIFY (count assertions)
    ├── init_cursor_test.ts                          MODIFY (count assertions)
    ├── init_codex_test.ts                           MODIFY (count assertions)
    ├── init_gemini_test.ts                          MODIFY (count assertions)
    └── init_windsurf_test.ts                        MODIFY (count assertions)
```

Expected net test count: 273 → 275.

---

## Task 1: Swap `frontmatterField` regex for `parseYaml`

**Files:**

- Modify: `src/infrastructure/harness/frontmatter.ts`
- Modify: `tests/infrastructure/harness/frontmatter_test.ts`

The current `frontmatterField` uses a single-line regex that returns the wrong value for valid YAML
inputs (block scalars, folded scalars, multi-line indented values). Switch to the standard YAML
parser.

- [ ] **Step 1: Add 2 failing tests to `tests/infrastructure/harness/frontmatter_test.ts`**

At the END of the file, append:

```typescript
Deno.test("frontmatterField: handles block scalar (|)", () => {
  const fmBody = "description: |\n  Line one.\n  Line two.\n";
  const value = frontmatterField(fmBody, "description");
  assertEquals(typeof value, "string");
  assert(value!.includes("Line one"));
  assert(value!.includes("Line two"));
});

Deno.test("frontmatterField: returns null for non-string values", () => {
  const fmBody = "count: 5\nflag: true\n";
  assertEquals(frontmatterField(fmBody, "count"), null);
  assertEquals(frontmatterField(fmBody, "flag"), null);
});
```

- [ ] **Step 2: Run — expect 2 failures**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/frontmatter_test.ts
```

Expected: `4 passed | 2 failed`. The new "block scalar" test fails because the regex returns literal
`"|"`. The "non-string values" test fails because the regex matches `5` or `true` as strings.

- [ ] **Step 3: Replace the implementation in `src/infrastructure/harness/frontmatter.ts`**

REPLACE the entire content of the file with EXACTLY:

```typescript
import { parse as parseYaml } from "@std/yaml";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export type FrontmatterParts = {
  readonly fmBody: string;
  readonly rest: string;
};

/**
 * Splits a markdown document into its YAML frontmatter body and the remaining content.
 * Returns null when the document has no frontmatter.
 */
export function splitFrontmatter(content: string): FrontmatterParts | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  return { fmBody: m[1], rest: m[2] };
}

/**
 * Extracts a single string field value from a YAML frontmatter body, or null if
 * the key is absent or the value is not a string. Properly handles block
 * scalars (`|`, `>`), multi-line values, and other valid YAML shapes by
 * delegating to `@std/yaml`.
 */
export function frontmatterField(fmBody: string, key: string): string | null {
  try {
    const parsed = parseYaml(fmBody);
    if (parsed && typeof parsed === "object" && key in parsed) {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "string" ? value : null;
    }
  } catch {
    // malformed YAML → null
  }
  return null;
}
```

Only `frontmatterField`'s body changed; `splitFrontmatter` and `FrontmatterParts` are unchanged. The
new `import { parse as parseYaml } from "@std/yaml"` line joins the existing imports.

- [ ] **Step 4: Run the focused test — expect 6 passed**

```bash
deno test tests/infrastructure/harness/frontmatter_test.ts
```

Expected: `ok | 6 passed | 0 failed` (4 existing + 2 new).

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 275 passed | 0 failed` (273 baseline + 2 new). All callers of `frontmatterField`
(Codex agent TOML emitter, Gemini agent + command emitters) continue to receive the same string
values they did before — single-line YAML scalars decode identically.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/harness/frontmatter.ts \
        tests/infrastructure/harness/frontmatter_test.ts \
        src/templates_bundle.ts
git commit -m "refactor(harness): use parseYaml in frontmatterField for correct YAML semantics"
```

---

## Task 2: Replace inline literal union with `Record<KnownHarness, string>`

**Files:**

- Modify: `src/infrastructure/fs_project_inspector.ts`

Type-level cleanup. The current `expectedFolder` Record duplicates the `KnownHarness` union
literal-by-literal; switching to the named type makes adding a 6th harness automatically fail
compilation here until the Record is extended.

- [ ] **Step 1: Read the existing import line**

Open `src/infrastructure/fs_project_inspector.ts` and locate the import from `installed_lock.ts`. It
currently looks like:

```typescript
import { parseLock } from "../domain/installed_lock.ts";
```

- [ ] **Step 2: Add `KnownHarness` to that import**

Replace the import line with:

```typescript
import { type KnownHarness, parseLock } from "../domain/installed_lock.ts";
```

- [ ] **Step 3: Replace the inline literal union with the named type**

Find the `expectedFolder` declaration inside `checkHarness`. It currently has:

```typescript
const expectedFolder: Record<
  "claude" | "cursor" | "codex" | "gemini" | "windsurf",
  string
> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
};
```

Replace with:

```typescript
const expectedFolder: Record<KnownHarness, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
};
```

The Record's runtime shape is identical; only the type widens to the named union.

- [ ] **Step 4: Type-check + run the full suite**

```bash
cd /Users/kevin/Sites/specflow
deno check src/main.ts
```

Expected: `Check src/main.ts` (exit 0).

```bash
deno task test
```

Expected: `ok | 275 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/fs_project_inspector.ts src/templates_bundle.ts
git commit -m "refactor(check): use Record<KnownHarness, string> for harness folder lookup"
```

---

## Task 3: Add per-directory count assertions to all 5 init integration tests

**Files:**

- Modify: `tests/integration/init_test.ts` (Claude — `.claude/commands/` 11, `.claude/agents/` 8)
- Modify: `tests/integration/init_cursor_test.ts` (`.cursor/skills/` 20)
- Modify: `tests/integration/init_codex_test.ts` (`.agents/skills/` 12, `.codex/agents/` 8)
- Modify: `tests/integration/init_gemini_test.ts` (`.gemini/commands/` 11, `.gemini/agents/` 8)
- Modify: `tests/integration/init_windsurf_test.ts` (`.windsurf/workflows/` 20)

Add count assertions inside each test, immediately after the existing block of `exists` checks. The
assertions are 1–2 extra lines per directory.

- [ ] **Step 1: Add assertions to `tests/integration/init_test.ts`** (Claude)

Find the test `"specflow init <name> writes a complete tree"`. After the existing line:

```typescript
assertEquals(await exists(join(root, ".claude/skills/speckit/SKILL.md")), true);
```

Add:

```typescript
const commandsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".claude/commands")),
)).length;
assertEquals(commandsCount, 11);
const agentsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".claude/agents")),
)).length;
assertEquals(agentsCount, 8);
```

- [ ] **Step 2: Add assertion to `tests/integration/init_cursor_test.ts`**

Find the test `"specflow init --ai cursor scaffolds a Cursor layout"`. After the line that checks
`.cursor/rules/specify-rules.mdc` exists:

```typescript
assertEquals(await exists(join(root, ".cursor/rules/specify-rules.mdc")), true);
```

Add:

```typescript
const skillsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".cursor/skills")),
)).length;
assertEquals(skillsCount, 20);
```

- [ ] **Step 3: Add assertions to `tests/integration/init_codex_test.ts`**

Find the test `"specflow init --ai codex scaffolds a Codex layout"`. After the TOML-parse block (the
section that reads `.codex/agents/product-owner.toml`), just before the "Shared (cross-harness)"
group, add:

```typescript
const agentsSkillsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".agents/skills")),
)).length;
assertEquals(agentsSkillsCount, 12);
const codexAgentsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".codex/agents")),
)).length;
assertEquals(codexAgentsCount, 8);
```

- [ ] **Step 4: Add assertions to `tests/integration/init_gemini_test.ts`**

Find the test `"specflow init --ai gemini scaffolds a Gemini layout"`. After the existing block of
`.gemini/commands/`, `.gemini/skills/`, and `.gemini/agents/` `exists` checks (just before the
"Shared" group), add:

```typescript
const commandsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".gemini/commands")),
)).length;
assertEquals(commandsCount, 11);
const agentsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".gemini/agents")),
)).length;
assertEquals(agentsCount, 8);
```

- [ ] **Step 5: Add assertion to `tests/integration/init_windsurf_test.ts`**

Find the test `"specflow init --ai windsurf scaffolds a Windsurf layout"`. After the existing block
of `.windsurf/workflows/...` exists checks (just before the "Shared" group), add:

```typescript
const workflowsCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".windsurf/workflows")),
)).length;
assertEquals(workflowsCount, 20);
```

- [ ] **Step 6: Run the full suite**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `ok | 275 passed | 0 failed`. The new assertions live inside existing `Deno.test(…)`
blocks, so the test count is unchanged from Task 1. If any count assertion fails, the bundle is
missing entries from a category — read the diff and trace back.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/init_test.ts \
        tests/integration/init_cursor_test.ts \
        tests/integration/init_codex_test.ts \
        tests/integration/init_gemini_test.ts \
        tests/integration/init_windsurf_test.ts
git commit -m "test(integration): assert per-harness file counts in init tests"
```

---

## Wrap-up

At the end of Task 3 the repo has:

- `frontmatterField` correctly handles all valid YAML scalar shapes (block, folded, multi-line
  indented) — silently-broken edge cases are gone.
- `Record<KnownHarness, string>` automatically expands when `KnownHarness` does; the inline literal
  duplication is gone.
- Every init integration test asserts exact counts for its harness's category directories — a
  missing-category regression now fails CI.
- 275 tests green.

### End-to-end validation

```bash
cd /Users/kevin/Sites/specflow
deno task test 2>&1 | tail -3
# expected: ok | 275 passed | 0 failed
```

No init/scaffold smoke needed — the 5 init tests already do that.

### Release (after merge)

- Squash-merge `fix/hygiene-combo` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.5.0-alpha.2` to `0.5.0-alpha.3`.
- `templates/manifest.json` stays at `0.6.1` (no template content edited).
- Re-run `deno task bundle` (will be a no-op since templates didn't change).
- Commit, tag `v0.5.0-alpha.3`, push main + tag.
