# Hygiene combo brick — design spec

**Goal.** Bundle three small fixes flagged in prior reviews into one short brick: swap
`frontmatterField`'s regex for proper YAML parsing, replace an inline union with
`Record<KnownHarness, string>`, and add file-count assertions to every `init_<harness>_test.ts` so a
silent missing-category regression fails CI.

**Why.** Each item is a small piece of debt called out in earlier code reviews. Bundling them means
one short release that closes three tracked items.

**Shipping.** Binary `0.5.0-alpha.2 → 0.5.0-alpha.3`, templates stay at `0.6.1` (no template content
changes). Patch release.

---

## Fix 1: `frontmatterField` regex → `parseYaml`

**File:** `src/infrastructure/harness/frontmatter.ts`

`frontmatterField` currently uses a single-line regex. It returns the wrong value for valid YAML
inputs: `description: |` returns `"|"`, `description: >-` returns `">-"`, and indented multi-line
values return only the first line. Specflow templates today use only single-line scalar
descriptions, so the bug is latent — but a future template author writing `description: |` for a
multi-paragraph description would silently emit garbage TOML for Codex/Gemini.

**Fix:** delegate to `@std/yaml` (already in the import map for `installed_lock.ts`):

```typescript
import { parse as parseYaml } from "@std/yaml";

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

The function still returns `string | null` for callers; only string values pass. Non-string
(numbers, lists, objects) → `null`, which matches existing call-site expectations.

**Behavior change for callers:** none today — every Specflow template uses single-line scalar fields
that parseYaml returns as strings. The function simply becomes correct for the multi-line cases we
don't currently exercise.

**Tests added** to `tests/infrastructure/harness/frontmatter_test.ts`:

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

The two existing tests (extracts a present key, returns null when absent) pass unchanged because
YAML's single-line scalar parsing matches the regex's behaviour for those inputs.

---

## Fix 2: `Record<"claude" | … | "windsurf", string>` → `Record<KnownHarness, string>`

**File:** `src/infrastructure/fs_project_inspector.ts`

`checkHarness` currently has an inline literal union duplicating `KnownHarness`:

```typescript
const expectedFolder: Record<
  "claude" | "cursor" | "codex" | "gemini" | "windsurf",
  string
> = { ... };
```

A future harness adds two type-mention sites to keep in sync (the union itself in
`installed_lock.ts` and this inline literal). Switch to the named type:

```typescript
import { type KnownHarness, parseLock } from "../domain/installed_lock.ts";

// inside checkHarness:
const expectedFolder: Record<KnownHarness, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
};
```

`KnownHarness` is already exported from `installed_lock.ts`. The current
`import { parseLock } from "..."` line gains a `type KnownHarness,` prefix.

After this change, adding a 6th harness fails compilation here until the `expectedFolder` Record is
extended — automatic guard.

**Tests:** none added or changed. The existing inspector tests continue to pass because the Record's
runtime shape is identical.

---

## Fix 3: Workflow / skill / agent count assertions in init integration tests

**Files:** all five `tests/integration/init_<harness>_test.ts`.

Each test currently asserts the existence of 3-4 representative paths but never asserts how many
files actually landed in each per-harness directory. A bundler or harness-adapter regression that
drops a category (e.g., emits 7 of 8 agents because of a typo) would slip through.

**Fix:** in each integration test, after the existing `assertEquals(... exists,
true)` block, add
`assertEquals(<readdir-count>, <expected>)` for each harness-specific directory:

| Harness  | Directory              | Expected count | Notes                                                  |
| -------- | ---------------------- | -------------- | ------------------------------------------------------ |
| Claude   | `.claude/commands/`    | 11             | 10 `specflow.<name>.md` + `backlog.md`                 |
| Claude   | `.claude/agents/`      | 8              | one per agent                                          |
| Cursor   | `.cursor/skills/`      | 20             | 10 commands + 1 backlog + 1 skill + 8 agents (subdirs) |
| Codex    | `.agents/skills/`      | 12             | 10 commands + 1 backlog + 1 skill (subdirs)            |
| Codex    | `.codex/agents/`       | 8              | one TOML per agent                                     |
| Gemini   | `.gemini/commands/`    | 11             | 10 commands + backlog (TOML files)                     |
| Gemini   | `.gemini/agents/`      | 8              | one markdown per agent                                 |
| Windsurf | `.windsurf/workflows/` | 20             | 10 commands + 1 backlog + 1 skill + 8 agents           |

Helper inside each test:

```typescript
async function countDir(path: string): Promise<number> {
  const entries = await Array.fromAsync(Deno.readDir(path));
  return entries.length;
}
```

(Or inline the two-line equivalent — same shape used in each file.)

Sample assertion (Windsurf):

```typescript
const workflowCount = (await Array.fromAsync(
  Deno.readDir(join(root, ".windsurf/workflows")),
)).length;
assertEquals(workflowCount, 20);
```

**Why each assertion is per-directory rather than a single total:** category- boundary regressions
(missing agents but present commands) need per-directory visibility. A total of 38 emitted files
would mask "9 commands + 8 agents" when expected is "11 commands + 8 agents".

**Tests added:** the assertions live inside existing `Deno.test(…)` blocks, so the test count
doesn't change for Fix 3. Coverage strengthens.

---

## Test count

Current: 273.

- Fix 1: +2 tests (block scalar handling, non-string value).
- Fix 2: +0.
- Fix 3: +0 (assertions added inside existing tests).

Expected final: **275**.

---

## Out of scope

- Updating templates to use multi-line YAML descriptions (Fix 1 enables it but no template needs it
  today).
- Generalising the cap-test pattern to non-Windsurf harnesses (the others have no documented limit).
- Switching `Bundle` keys or `KnownHarness` semantics — purely a localised type-level cleanup.

---

## Release plan

1. Branch `fix/hygiene-combo` from main.
2. Three independent commits in any order (no inter-task dependencies):
   - `frontmatter.ts` → `parseYaml` + 2 new tests.
   - `fs_project_inspector.ts` → `Record<KnownHarness, string>`.
   - All 5 init integration tests gain count assertions (one commit, since they're parallel
     changes).
3. Verify full suite green at 275.
4. Squash-merge to main.
5. Bump binary `0.5.0-alpha.2 → 0.5.0-alpha.3`; templates stay at `0.6.1`. Tag `v0.5.0-alpha.3`;
   push main + tag.
