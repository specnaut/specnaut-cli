# Specflow rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every `speckit`/`.specify` identifier to `specflow`/`.specflow` across template
sources, adapter destinations, and in-template text references.

**Architecture:** Mechanical search-and-replace across the templates tree plus small edits in two
harness adapters (`ClaudeHarness`, `CursorHarness`). No new code paths, no new tests — existing
snapshot/destination assertions are updated in place. The test suite stays at 223 green.

**Tech Stack:** Deno 2 + TypeScript. No new deps. Uses `git mv` to preserve file history, `sed -i`
(BSD flavor on macOS needs `''` after `-i`) for text substitutions.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-rename-design.md`

---

## File Structure (changes)

```
templates/
├── manifest.json                                    MODIFY  (25 source paths)
├── core/
│   ├── commands/
│   │   ├── backlog.md                               (unchanged)
│   │   └── specflow.<name>.md                       RENAME  (from speckit.<name>.md, ×10)
│   └── specflow/                                    RENAME  (from specify/)
│       ├── memory/constitution.md                   MODIFY  (content sed)
│       ├── scripts/
│       │   ├── bash/*.sh                            MODIFY  (content sed, 2 files)
│       │   └── powershell/*.ps1                     MODIFY  (content sed, 2 files)
│       └── templates/*.md                           MODIFY  (content sed, 1 file)
├── core/agents/*.md                                 MODIFY  (content sed, several)
├── core/skills/speckit/SKILL.md                     MODIFY  (content sed)
└── harness-specific/
    ├── claude/CLAUDE.md                             MODIFY  (content sed, if applicable)
    └── cursor/specify-rules.mdc                     MODIFY  (content sed)

src/
├── infrastructure/harness/claude_harness.ts         MODIFY  (2 destination branches)
├── infrastructure/harness/cursor_harness.ts         MODIFY  (2 destination branches)
└── templates_bundle.ts                              REGENERATED (via deno task bundle)

tests/
├── infrastructure/harness/claude_harness_test.ts    MODIFY  (4 spot-check paths)
├── infrastructure/harness/cursor_harness_test.ts    MODIFY  (skill-folder + spec-root)
└── integration/init_cursor_test.ts                  MODIFY  (3 path expectations)

README.md, AGENTS.md                                 MODIFY  (doc references)
```

**Out of file-scope:** `deno.json`, `src/domain/version.ts` — version bumps happen with the Codex
release, not this brick.

---

## Task 1: Rename command source files + manifest

**Files:**

- Rename: `templates/core/commands/speckit.<name>.md` → `specflow.<name>.md` (×10)
- Modify: `templates/manifest.json`

- [ ] **Step 1: Git-move the 10 command source files**

```bash
cd /Users/kevin/Sites/specflow/templates/core/commands
for name in analyze checklist clarify constitution implement merge plan review specify tasks; do
  git mv "speckit.${name}.md" "specflow.${name}.md"
done
cd -
```

Verify:

```bash
ls templates/core/commands/
# expected: backlog.md, specflow.analyze.md, specflow.checklist.md, …, specflow.tasks.md
```

- [ ] **Step 2: Update `templates/manifest.json` source paths**

Open `templates/manifest.json`. For each of the 10 command entries (category `"command"`), replace
`"source": "core/commands/speckit.<name>.md"` with `"source": "core/commands/specflow.<name>.md"`.

The `backlog` entry (category `"backlog-cmd"`) is unchanged.

After the edit, run:

```bash
grep -c '"source": "core/commands/speckit\.' templates/manifest.json
# expected: 0
grep -c '"source": "core/commands/specflow\.' templates/manifest.json
# expected: 10
```

- [ ] **Step 3: Run the bundler to confirm sources resolve**

```bash
deno task bundle
# expected: Bundled 38 core entries + 2 harness-specific → src/templates_bundle.ts
```

- [ ] **Step 4: Run the full suite**

```bash
deno task test
# expected: ok | 223 passed | 0 failed
```

Tests still pass because destination paths are unchanged — `ClaudeHarness` still emits
`.claude/commands/speckit.<name>.md` regardless of the source filename.

- [ ] **Step 5: Commit**

```bash
git add templates/core/commands templates/manifest.json src/templates_bundle.ts
git commit -m "refactor(templates): rename command source files speckit.* → specflow.*"
```

---

## Task 2: Rename `templates/core/specify/` → `templates/core/specflow/`

**Files:**

- Rename: `templates/core/specify/` → `templates/core/specflow/`
- Modify: `templates/manifest.json`

- [ ] **Step 1: Git-move the folder**

```bash
cd /Users/kevin/Sites/specflow
git mv templates/core/specify templates/core/specflow
```

Verify:

```bash
ls templates/core/specflow/
# expected: memory, scripts, templates
```

- [ ] **Step 2: Update `templates/manifest.json` source paths for spec-root entries**

Replace every `"source": "core/specify/` with `"source": "core/specflow/` in the 15 `spec-root`
entries. Use find-and-replace-all in the file.

Verify:

```bash
grep -c '"source": "core/specify/' templates/manifest.json
# expected: 0
grep -c '"source": "core/specflow/' templates/manifest.json
# expected: 15
```

- [ ] **Step 3: Re-bundle and test**

```bash
deno task bundle
# expected: Bundled 38 core entries + 2 harness-specific → src/templates_bundle.ts
deno task test
# expected: ok | 223 passed | 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add templates/core/specflow templates/manifest.json src/templates_bundle.ts
git commit -m "refactor(templates): rename core/specify → core/specflow"
```

---

## Task 3: Update `ClaudeHarness` destinations

**Files:**

- Modify: `src/infrastructure/harness/claude_harness.ts`
- Modify: `tests/infrastructure/harness/claude_harness_test.ts`

- [ ] **Step 1: Update the test first (TDD — this makes it fail)**

Replace the full contents of `tests/infrastructure/harness/claude_harness_test.ts` with:

```typescript
import { assert, assertEquals } from "@std/assert";
import { ClaudeHarness } from "../../../src/infrastructure/harness/claude_harness.ts";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../../src/templates_bundle.ts";

Deno.test("ClaudeHarness.key and displayName", () => {
  const h = new ClaudeHarness();
  assertEquals(h.key, "claude");
  assertEquals(h.displayName, "Claude Code");
});

Deno.test("ClaudeHarness.mapBundle emits the Claude tree", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const keys = Object.keys(mapped).sort();
  assertEquals(keys.length, 39); // 38 core + CLAUDE.md
  // Spot-check canonical paths
  assert(".claude/commands/specflow.specify.md" in mapped);
  assert(".claude/commands/backlog.md" in mapped);
  assert(".claude/agents/product-owner.md" in mapped);
  assert(".claude/skills/speckit/SKILL.md" in mapped);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
  assert("CLAUDE.md" in mapped);
});

Deno.test("ClaudeHarness includes HARNESS_STATIC claude files (CLAUDE.md)", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const claudeMd = mapped["CLAUDE.md"];
  const staticClaude = HARNESS_STATIC.claude["CLAUDE.md"];
  assertEquals(claudeMd?.content, staticClaude?.content);
});
```

Note: the internal skill folder source `templates/core/skills/speckit/SKILL.md` still produces
`.claude/skills/speckit/SKILL.md` (internal name unchanged — spec called this out as out-of-scope).

- [ ] **Step 2: Run — expect FAIL**

```bash
deno test tests/infrastructure/harness/claude_harness_test.ts
# expected: FAIL — ".claude/commands/specflow.specify.md" not in mapped; got ".claude/commands/speckit.specify.md"
```

- [ ] **Step 3: Update `ClaudeHarness.destinationFor`**

Open `src/infrastructure/harness/claude_harness.ts`. Change the two affected cases:

```typescript
function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.claude/commands/specflow.${entry.name}.md`;
    case "backlog-cmd":
      return `.claude/commands/${entry.name}.md`;
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "skill":
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root entry needs suffix: ${entry.name}`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root entry needs suffix: ${entry.name}`);
      return entry.suffix;
  }
}
```

Only two lines change: the `command` case (`speckit.` → `specflow.`) and the `spec-root` case
(`.specify/` → `.specflow/`).

- [ ] **Step 4: Re-bundle and run the full suite**

```bash
deno task bundle
deno task test
# expected: ok | 223 passed | 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/harness/claude_harness.ts \
        tests/infrastructure/harness/claude_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(claude-harness): rename destinations speckit.* → specflow.* and .specify/ → .specflow/"
```

---

## Task 4: Update `CursorHarness` destinations

**Files:**

- Modify: `src/infrastructure/harness/cursor_harness.ts`
- Modify: `tests/infrastructure/harness/cursor_harness_test.ts`

- [ ] **Step 1: Update test expectations (TDD — makes tests fail)**

In `tests/infrastructure/harness/cursor_harness_test.ts`, find the three tests that reference old
paths and update each as follows.

Find:

```typescript
Deno.test("CursorHarness maps commands to .cursor/skills/speckit-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/speckit-specify/SKILL.md" in mapped);
});
```

Replace with:

```typescript
Deno.test("CursorHarness maps commands to .cursor/skills/specflow-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-specify/SKILL.md" in mapped);
});
```

Find:

```typescript
Deno.test("CursorHarness injects name: frontmatter when absent", () => {
  const withoutName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withoutName);
  const skill = mapped[".cursor/skills/speckit-specify/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: speckit-specify"));
});
```

Replace with:

```typescript
Deno.test("CursorHarness injects name: frontmatter when absent", () => {
  const withoutName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withoutName);
  const skill = mapped[".cursor/skills/specflow-specify/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specflow-specify"));
});
```

Find:

```typescript
Deno.test("CursorHarness preserves original name: when already present", () => {
  const withName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: custom-name\ndescription: Explicit\n---\n\n# body\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withName);
  const skill = mapped[".cursor/skills/speckit-specify/SKILL.md"];
  // Original frontmatter is preserved — we do not override a user-provided name.
  assertEquals(skill?.content.includes("name: custom-name"), true);
});
```

Replace with:

```typescript
Deno.test("CursorHarness preserves original name: when already present", () => {
  const withName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: custom-name\ndescription: Explicit\n---\n\n# body\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withName);
  const skill = mapped[".cursor/skills/specflow-specify/SKILL.md"];
  // Original frontmatter is preserved — we do not override a user-provided name.
  assertEquals(skill?.content.includes("name: custom-name"), true);
});
```

- [ ] **Step 2: Run — expect FAIL on the 3 modified tests**

```bash
deno test tests/infrastructure/harness/cursor_harness_test.ts
# expected: FAILED | 6 passed | 3 failed
```

- [ ] **Step 3: Update `CursorHarness`**

Open `src/infrastructure/harness/cursor_harness.ts`. Change two cases:

In `cursorSkillName`, update the `command` case:

```typescript
function cursorSkillName(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `specflow-${entry.name}`;
    case "backlog-cmd":
      return `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    case "skill":
      return `specflow-${entry.name}`;
    default:
      throw new Error(`cursorSkillName not applicable for category: ${entry.category}`);
  }
}
```

Only one line changes: the `command` case (`speckit-` → `specflow-`). After this change, `command`
and `backlog-cmd` happen to produce the same prefix, but the branches stay distinct for future
divergence.

In `destinationFor`, update the `spec-root` case:

```typescript
function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.cursor/skills/${cursorSkillName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}
```

Only one line changes: `.specify/` → `.specflow/`.

- [ ] **Step 4: Re-bundle and run**

```bash
deno task bundle
deno task test
# expected: ok | 223 passed | 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/harness/cursor_harness.ts \
        tests/infrastructure/harness/cursor_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(cursor-harness): rename destinations speckit- → specflow- and .specify/ → .specflow/"
```

---

## Task 5: Bulk sed on template contents

**Files:**

- Modify: every file under `templates/` that contains `.specify/`, `speckit.`, or `speckit-`
  (currently 17 files total — see the spec's audit)

This step rewrites the text cross-references inside template content. The source and destination
paths are already on the new names; this aligns the narrative text inside each file.

- [ ] **Step 1: Apply the substitutions**

From the project root:

```bash
cd /Users/kevin/Sites/specflow

# macOS BSD sed: -i '' (empty extension)
# Linux GNU sed: -i (no arg) — if running on Linux, drop the '' below.
find templates -type f \( -name '*.md' -o -name '*.mdc' -o -name '*.sh' -o -name '*.ps1' -o -name '*.json' \) -print0 |
  xargs -0 sed -i '' \
    -e 's|\.specify/|.specflow/|g' \
    -e 's|speckit\.|specflow.|g' \
    -e 's|speckit-|specflow-|g'
```

Notes on the patterns:

- `\.specify/` — matches the literal `.specify/` prefix. The leading backslash escapes the dot in
  the regex context.
- `speckit\.` — matches `speckit.` with a literal dot (avoids false positives on `speckita`-style
  tokens that don't exist anyway, but the escape is correct).
- `speckit-` — matches the hyphenated form used inside Cursor's rules file.

- [ ] **Step 2: Verify no old references remain**

```bash
grep -rn '\.specify/' templates/
# expected: (no output)
grep -rn 'speckit\.' templates/
# expected: (no output)
grep -rn 'speckit-' templates/
# expected: (no output)
```

If any of the three greps prints a line, read it and decide whether it's a legitimate use (e.g. the
word "speckit" appears without a dot or hyphen and describes the upstream fork source — those
stays). For the literal `.specify/`, `speckit.`, and `speckit-` patterns, every hit is a bug.

- [ ] **Step 3: Re-bundle and test**

```bash
deno task bundle
# expected: Bundled 38 core entries + 2 harness-specific → src/templates_bundle.ts
deno task test
# expected: ok | 223 passed | 0 failed
```

The bundler embeds the new template contents into `src/templates_bundle.ts`; the generated file diff
will be large but mechanical.

- [ ] **Step 4: Commit**

```bash
git add templates src/templates_bundle.ts
git commit -m "refactor(templates): rename speckit/.specify references to specflow/.specflow in template content"
```

---

## Task 6: Update the integration test expectations

**Files:**

- Modify: `tests/integration/init_cursor_test.ts`

- [ ] **Step 1: Update the Cursor scaffold expectations**

Open `tests/integration/init_cursor_test.ts`. Inside
`Deno.test("specflow init --ai cursor scaffolds a Cursor layout", …)`, update the path assertions as
follows (old → new):

```diff
-    assertEquals(await exists(join(root, ".cursor/skills/speckit-specify/SKILL.md")), true);
+    assertEquals(await exists(join(root, ".cursor/skills/specflow-specify/SKILL.md")), true);
     assertEquals(
       await exists(join(root, ".cursor/skills/specflow-agent-product-owner/SKILL.md")),
       true,
     );
     assertEquals(await exists(join(root, ".cursor/skills/specflow-speckit/SKILL.md")), true);
     assertEquals(await exists(join(root, ".cursor/rules/specify-rules.mdc")), true);
     // Shared
-    assertEquals(await exists(join(root, ".specify/memory/constitution.md")), true);
+    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
     assertEquals(await exists(join(root, "AGENTS.md")), true);
     assertEquals(await exists(join(root, "tasks/backlog.md")), true);
```

The `.cursor/rules/specify-rules.mdc` path is NOT renamed — that's the filename of the Cursor rules
config, which lives under `harness-specific/cursor/` and is out of scope for the `.specify/` →
`.specflow/` rename (the filename is a Cursor-world identifier pointing at Specflow content, not a
`.specify/` path).

The `specflow-speckit` skill-folder name is also unchanged — the internal skill name "speckit"
remains (spec called this out as out of scope).

- [ ] **Step 2: Run the integration tests**

```bash
deno test --allow-all tests/integration/init_cursor_test.ts
# expected: ok | 2 passed | 0 failed
```

- [ ] **Step 3: Run the full suite**

```bash
deno task test
# expected: ok | 223 passed | 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_cursor_test.ts
git commit -m "test(integration): update cursor init expectations for specflow/.specflow rename"
```

---

## Task 7: Update project docs (README + AGENTS.md)

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md references**

Open `AGENTS.md`. Replace the 5 legacy references:

Line ~58 block — in the "v0.2 scope — multi-harness ready" bullet:

```diff
-  - Two target harnesses: **Claude Code** (default, `.claude/` + `.specify/`) and **Cursor**
-    (`.cursor/skills/` + `.cursor/rules/` + `.specify/`) — single harness per invocation, selected
-    via `--ai claude|cursor`
+  - Two target harnesses: **Claude Code** (default, `.claude/` + `.specflow/`) and **Cursor**
+    (`.cursor/skills/` + `.cursor/rules/` + `.specflow/`) — single harness per invocation, selected
+    via `--ai claude|cursor`
```

Line ~113 block — in the "Constitution + spec templates" section:

```diff
-A `.specify/memory/constitution.md` file codifies project invariants (non-negotiable architecture,
-conventions, policies). Spec Kit loads
-`.specify/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` to generate the
-artefacts.
+A `.specflow/memory/constitution.md` file codifies project invariants (non-negotiable architecture,
+conventions, policies). Spec Kit loads
+`.specflow/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` to generate the
+artefacts.
```

Line ~123 — leave as-is:

```text
- A `speckit` skill acts as a single dispatcher …
```

This line is describing an historical pattern observed in `examples/`; the word "speckit" here
refers to the upstream fork source, not a Specflow identifier.

- [ ] **Step 2: Verify no other old references in AGENTS.md**

```bash
grep -n '\.specify/' AGENTS.md
# expected: (no output)
```

`speckit-` and `speckit.` do not appear in `AGENTS.md` per the prior audit.

- [ ] **Step 3: Update README.md if necessary**

```bash
grep -n '\.specify/\|speckit-\|speckit\.' README.md
# expected: (no output — README uses only generic terms)
```

If any hit appears, apply the same substitution pattern. If none, no edit needed.

- [ ] **Step 4: Run the bundler + tests once more**

```bash
deno task bundle
deno task test
# expected: ok | 223 passed | 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: update README + AGENTS.md references from .specify/ to .specflow/"
```

---

## Wrap-up

After Task 7 the repo has:

- Every user-visible `speckit.<name>` / `speckit-<name>` command identifier renamed to
  `specflow.<name>` / `specflow-<name>`
- Every `.specify/` directory reference renamed to `.specflow/` (sources, destinations, in-template
  text)
- `templates/core/specify/` moved to `templates/core/specflow/`
- 10 `templates/core/commands/speckit.<name>.md` files renamed to `specflow.<name>.md`
- Test suite still 223 green, no new tests
- Binary / templates version fields unchanged (bump lands with Codex)

### End-to-end validation

1. `deno task test` — all green.
2. Clean init to check the scaffold looks right:

```bash
rm -rf /tmp/sf-rename-demo && mkdir /tmp/sf-rename-demo
cd /tmp/sf-rename-demo
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init claude-demo --no-git
ls claude-demo/.claude/commands/ | head
# expected: backlog.md, specflow.analyze.md, specflow.checklist.md, ...
ls claude-demo/.specflow/memory/
# expected: constitution.md
cd -
```

```bash
rm -rf /tmp/sf-rename-demo2 && mkdir /tmp/sf-rename-demo2
cd /tmp/sf-rename-demo2
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init cursor-demo --no-git --ai cursor
ls cursor-demo/.cursor/skills/ | head
# expected: specflow-specify, specflow-clarify, …, specflow-agent-product-owner, specflow-backlog, specflow-speckit
ls cursor-demo/.specflow/memory/
# expected: constitution.md
test ! -d cursor-demo/.specify   # expected: exit 0 (directory does not exist)
cd -
```

3. Ready for the Codex brick on top.

### Out of scope (reminder)

- Version bumps (`deno.json`, `src/domain/version.ts`)
- Codex adapter
- Migration logic for alpha.1 installs
- Internal `templates/core/skills/speckit/` source folder rename
- The internal manifest `name: "specify"` label for spec-root entries (cosmetic only)
- `.cursor/rules/specify-rules.mdc` filename (Cursor-world identifier)
