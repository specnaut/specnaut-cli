# PO agent Bash allowlist + memory-home directive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the silent-wrong-recommendation failure mode in the bundled `product-owner.md` agent
template by widening its `tools:` frontmatter to full `Bash` and adding the missing first-action
protocol (with explicit memory-home directive) so the agent always reality-checks before answering.

**Architecture:** Pure template edit in `templates/core/agents/product-owner.md` with byte-identical
mirror in `plugin/agents/product-owner.md`. The change reduces the `tools:` line from 97 chars to 42
(freeing 55 chars), and replaces the existing "First action" section with an expanded version that
folds in the new mandatory checks (`git branch --show-current`, `git log --oneline -5`, read
`MEMORY.md`, query live backlog) **and** the memory-home directive. Net source growth ~ +67 chars,
which fits comfortably in the current 64-char Windsurf headroom plus the 55 chars freed by the
tools-line trim (post-render rendered size budget: 119 chars of headroom).

**Tech Stack:** Deno 2.x · TypeScript · template bundle generated via `deno task bundle` ·
byte-identity enforced by `tests/plugin/plugin_sync_test.ts` · Windsurf 12000-char cap enforced by
`tests/infrastructure/harness/windsurf_harness_test.ts:123-133`.

---

## Context

Issue #258 reports that the bundled `product-owner.md` agent ships with a narrow Bash allowlist
(`Bash(git log *), Bash(git diff *), Bash(gh issue *), Bash(gh api *)`) that prevents the agent from
doing the basic reality-checks its core "what's next?" flow demands: `git branch --show-current`,
`git status`, `ls`/`find`/`grep` to confirm whether a task is already implemented, and
`gh project *` to read the live board. The agent silently falls back to inferring from local files +
stale memory and produces confident-looking but wrong recommendations.

A secondary defect: the template body does not tell the PO where its persistent memory lives. Today
the scaffolded `.claude/agents/product-owner/memory/` directory exists, but nothing in the template
instructs the agent that this — and only this — is the canonical memory home. As a result, deployed
PO agents in the wild splinter state across `.claude/agent-memory/<name>/` and
`.claude/agents/<name>/memory/` simultaneously.

The fix is a single template file edit (mirrored to the plugin copy) and a handful of smoke
assertions to lock the new content. `specflow upgrade` delivers it via the normal bundle path — no
migration code needed.

## File Structure

- **Modify**: `templates/core/agents/product-owner.md` — the canonical agent template.
- **Modify**: `plugin/agents/product-owner.md` — byte-identical mirror (enforced by
  `tests/plugin/plugin_sync_test.ts:57`).
- **Modify**: `.claude/skills/test-sandbox/scripts/smoke-features.sh` — add 3 new assertions to lock
  the new directives.
- **No code changes.** No new files. No new types.

The template is currently **12 066 bytes** on disk; rendered through the Windsurf harness it
produces **11 936 chars** (64 chars headroom under the 12 000 cap). The Windsurf harness strips the
`color:` frontmatter line and does additional normalization that totals ~130 chars saved
post-render. Net plan: tools-line trim frees 55 source chars; new "First action" content adds ~122
source chars; net source growth ~67 chars; rendered headroom after the change projected at ~52 chars
(still under cap).

---

## Tasks

### Task 1: Widen `tools:` frontmatter to full Bash

**Files:**

- Modify: `templates/core/agents/product-owner.md:5`
- Modify: `plugin/agents/product-owner.md:5`

The current narrow allowlist forces the PO into silent failure when it needs `git status`,
`git branch`, `ls`, `find`, `grep`, or `gh project *`. The cleanest fix — and the one the AC
explicitly endorses ("full Bash, matching `developer.md`") — is the unrestricted `Bash` token. As a
bonus this is **shorter** than the current line (42 vs 97 chars), freeing 55 chars for the new
content in Task 2.

- [ ] **Step 1: Edit the source template**

Change line 5 of `templates/core/agents/product-owner.md` from:

```yaml
tools: Read, Write, Edit, Grep, Glob, Bash(git log *), Bash(git diff *), Bash(gh issue *), Bash(gh api *)
```

to:

```yaml
tools: Read, Write, Edit, Grep, Glob, Bash
```

- [ ] **Step 2: Mirror to the plugin copy**

Same edit at line 5 of `plugin/agents/product-owner.md`. Faster path: copy the source file onto the
plugin file verbatim after editing the source:

```bash
cp /Users/kevin/Sites/specflow/templates/core/agents/product-owner.md \
   /Users/kevin/Sites/specflow/plugin/agents/product-owner.md
diff /Users/kevin/Sites/specflow/templates/core/agents/product-owner.md \
     /Users/kevin/Sites/specflow/plugin/agents/product-owner.md
```

Expected: `diff` produces zero output.

- [ ] **Step 3: Verify the byte-identity test still passes**

```bash
deno test tests/plugin/plugin_sync_test.ts
```

Expected: `ok | 1 passed | 0 failed` (the SYNC_PAIRS row for `product-owner.md` reads both files and
asserts byte equality).

- [ ] **Step 4: Verify the Windsurf cap test still passes after rebundle**

```bash
deno task bundle && deno test tests/infrastructure/harness/windsurf_harness_test.ts --filter "Cascade cap"
```

Expected: `ok | 1 passed | 0 failed`. (The bundle step regenerates `src/templates_bundle.ts` from
the modified template; the cap test then exercises the rendered Windsurf output.)

- [ ] **Step 5: Run the full test suite — must be green**

```bash
deno task test
```

Expected: all 643+ tests pass. No new tests yet (they land in Task 3).

- [ ] **Step 6: Commit**

```bash
git add templates/core/agents/product-owner.md plugin/agents/product-owner.md
git commit -m "fix(agents): widen product-owner Bash allowlist to full Bash

The narrow allowlist (gh issue/api + git log/diff) prevented the PO
agent from running the reality-checks its 'what's next?' flow needs:
git branch --show-current, git status, ls/find/grep to verify a task
is already implemented, gh project * to read the live board. The
agent silently fell back to inference from stale local state and
produced confident-looking but wrong recommendations.

Matches the developer.md template's pattern. Bonus: -55 chars on a
template that's tight against the Windsurf 12k cap.

Refs #258."
```

---

### Task 2: Expand "First action" section with memory-home + reality-checks

**Files:**

- Modify: `templates/core/agents/product-owner.md:13-18`
- Modify: `plugin/agents/product-owner.md:13-18`

The existing section is 6 lines covering only `AGENTS.md` + `constitution.md`. Replace it with a
4-step protocol that adds (a) the git reality-checks, (b) the memory-home read with the negative
directive about `.claude/agent-memory/`, and (c) the mandatory live-backlog query before any "what's
next?" answer.

- [ ] **Step 1: Edit the source template**

Replace lines 13-18 of `templates/core/agents/product-owner.md`. The current text is:

```markdown
## First action in every session

Read `AGENTS.md` at the project root AND `.specflow/memory/constitution.md` to refresh product and
architectural context. Then identify which backlog backend the project uses (see "Backlog backend"
below). If either context file is missing or empty, flag it to the user — the project is
under-documented.
```

Replace with:

```markdown
## First action in every session

Run these in order, every time before answering:

1. `git branch --show-current` + `git log --oneline -5` — locate yourself.
2. Read `AGENTS.md` + `.specflow/memory/constitution.md` for context.
3. Read `.claude/agents/product-owner/memory/MEMORY.md` — your persistent memory home. **Never**
   write to `.claude/agent-memory/`; that path is unused.
4. Query the live backlog (`gh issue list` / `list.sh`) before answering "what's next?" — never
   infer from local files or memory alone.

Flag any missing context file — the project is under-documented.
```

- [ ] **Step 2: Mirror to the plugin copy**

```bash
cp /Users/kevin/Sites/specflow/templates/core/agents/product-owner.md \
   /Users/kevin/Sites/specflow/plugin/agents/product-owner.md
diff /Users/kevin/Sites/specflow/templates/core/agents/product-owner.md \
     /Users/kevin/Sites/specflow/plugin/agents/product-owner.md
```

Expected: `diff` produces zero output.

- [ ] **Step 3: Verify byte counts are within budget**

```bash
wc -c templates/core/agents/product-owner.md
```

Expected: ~12 133 bytes (source size after the edit; was 12 066, +67 net after Task 1 trim and Task
2 expansion).

```bash
deno task bundle
```

Expected: `Bundled 83 core entries + 11 harness-specific → src/templates_bundle.ts`.

- [ ] **Step 4: Verify the Windsurf cap test passes after rebundle**

```bash
deno test tests/infrastructure/harness/windsurf_harness_test.ts --filter "Cascade cap"
```

Expected: `ok | 1 passed | 0 failed`. The rendered output for
`.windsurf/workflows/specflow-agent-product-owner.md` should be ≤ 12 000 chars (projected ~11 948,
~52 chars headroom).

If this step fails with `exceeds 12000 chars: <N>` (e.g. N=12 050), surface the failure and
**stop**. The fallback trim target is the `### Closing rules (all three backends)` paragraph at
lines 111-116 of the current template — the GitHub/GitLab two-step bullet is the densest and most
condensable. Do **not** trim by editing the new section just added.

- [ ] **Step 5: Verify the byte-identity test passes**

```bash
deno test tests/plugin/plugin_sync_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 6: Run the full test suite**

```bash
deno task test
```

Expected: all 643+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add templates/core/agents/product-owner.md plugin/agents/product-owner.md
git commit -m "feat(agents): add first-action protocol + memory-home directive to PO

Expands the 'First action in every session' section with four
mandatory reality-checks the PO must run before answering:

1. git branch + git log to locate itself in the repo's history.
2. AGENTS.md + constitution.md for product/arch context (unchanged).
3. .claude/agents/product-owner/memory/MEMORY.md — explicitly named
   as the persistent memory home, with a negative directive that
   .claude/agent-memory/ is NOT used. This kills the splinter-state
   bug where deployed PO agents wrote to both paths simultaneously.
4. Live backlog query — never answer 'what's next?' from inference.

Pairs with the previous commit that widened the tools allowlist so
these checks can actually run. Net source +67 chars; rendered output
stays under the Windsurf 12k cap.

Refs #258."
```

---

### Task 3: Add smoke assertions to lock the new content

**Files:**

- Modify: `.claude/skills/test-sandbox/scripts/smoke-features.sh` (after the existing three
  product-owner assertions at lines 189, 191, 193)

The smoke harness already asserts a few PO-specific strings on the scaffolded output. Add three new
assertions to lock the new content so a future condensation pass can't quietly drop the new
directives.

- [ ] **Step 1: Locate the existing PO assertions**

```bash
grep -n "product-owner.md" .claude/skills/test-sandbox/scripts/smoke-features.sh
```

Expected: lines 189, 191, 193 — three existing `check` invocations grepping for
`Epic detection heuristic`, `cascade-check.sh`, and `parent::#` respectively.

- [ ] **Step 2: Add three new assertions immediately after line 193**

Open `.claude/skills/test-sandbox/scripts/smoke-features.sh` and insert (after the existing
`parent::#` assertion line):

```bash
check "PO agent has full Bash allowlist" \
  'grep -q "^tools: Read, Write, Edit, Grep, Glob, Bash$" .claude/agents/product-owner.md'
check "PO agent documents memory home path" \
  'grep -q ".claude/agents/product-owner/memory/MEMORY.md" .claude/agents/product-owner.md'
check "PO agent forbids legacy agent-memory path" \
  'grep -q ".claude/agent-memory/" .claude/agents/product-owner.md && grep -q "unused\|never\|not used" .claude/agents/product-owner.md'
```

Match the existing formatting (two-space indent, line continuation style) so `deno fmt` / shellcheck
stay quiet. Pattern: each `check` block is the description (string) followed by the grep predicate
(string), exactly like the surrounding assertions.

- [ ] **Step 3: Run the smoke suite locally**

```bash
bash .claude/skills/test-sandbox/scripts/smoke-features.sh 2>&1 | tail -20
```

Expected: all checks pass, including the three new ones. The smoke script scaffolds a fresh init
into a temp dir and runs the assertions against it; since Task 2 already landed in the template, the
new assertions should green.

- [ ] **Step 4: Run the smoke-coverage audit**

```bash
bash .claude/skills/test-sandbox/scripts/audit.sh
```

Expected: `0 coverage gap(s)`, `0 stale assertion(s)`. The audit cross-references template surfaces
against smoke assertions — adding three assertions for surfaces touched in Task 2 should not
introduce gaps.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/test-sandbox/scripts/smoke-features.sh
git commit -m "test(smoke): lock PO Bash allowlist + memory-home directives

Three new assertions in smoke-features.sh covering the surfaces
touched in the previous two commits:

1. The tools: line is the exact full-Bash form (regression guard
   against a future narrow-allowlist re-introduction).
2. The agent body names .claude/agents/product-owner/memory/MEMORY.md
   as the memory home.
3. The agent body explicitly negates .claude/agent-memory/ as unused.

Refs #258."
```

---

### Task 4: End-to-end verification + open the PR

**Files:** none — verification + git/gh actions only.

- [ ] **Step 1: Verify the branch state is clean and tests pass**

```bash
git status --porcelain   # must be empty
deno task test 2>&1 | tail -3
```

Expected: empty status; test suite green.

- [ ] **Step 2: Verify the smoke-coverage audit is green**

```bash
bash .claude/skills/test-sandbox/scripts/audit.sh 2>&1 | tail -5
```

Expected: `0 coverage gap(s)`, `0 stale assertion(s)`.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin fix/po-bash-allowlist-and-memory-home
```

- [ ] **Step 4: Open the PR with the adoption block**

Use the REST API (avoids GraphQL rate-limit issues) — write the body to `/tmp/pr-258-body.md` first:

````markdown
Closes #258.

## Summary

Fixes the silent-wrong-recommendation failure mode in the bundled `product-owner.md` agent. Two
related root causes:

1. The narrow Bash allowlist (`Bash(git log *), Bash(git diff *), Bash(gh issue *), Bash(gh api *)`)
   prevented the agent from running the reality-checks its "what's next?" flow demands:
   `git branch --show-current`, `git status`, `ls`/`find`/`grep`, `gh project *`. Falls back to
   inference from stale local state, presents confident but wrong recommendations.
2. The template body never named the canonical memory home, so deployed PO agents splintered state
   across `.claude/agents/<name>/memory/` and `.claude/agent-memory/<name>/` simultaneously.

Changes:

- Widen `tools:` to `Read, Write, Edit, Grep, Glob, Bash` (matches `developer.md`). Bonus: -55
  source chars on a template that's tight against the Windsurf 12k cap.
- Replace the "First action in every session" section with a 4-step protocol: `git branch`/`git log`
  reality-check → `AGENTS.md` + constitution → `MEMORY.md` read with explicit memory-home directive
  (and negative directive against `.claude/agent-memory/`) → live backlog query before any "what's
  next?".
- Three new smoke assertions lock the new content against future condensation passes.

Byte-identity preserved between `templates/core/agents/product-owner.md` and
`plugin/agents/product-owner.md`. Windsurf cap test passes (rendered output well under 12 000
chars).

## Test plan

- `deno task test` — all 643+ tests green.
- `tests/plugin/plugin_sync_test.ts` — byte-identity preserved.
- `tests/infrastructure/harness/windsurf_harness_test.ts` — rendered PO file ≤ 12 000 chars.
- `bash .claude/skills/test-sandbox/scripts/smoke-features.sh` — green, including the three new PO
  assertions.
- `bash .claude/skills/test-sandbox/scripts/audit.sh` — 0 gaps, 0 stale.

## Agent adoption

After `specflow upgrade`, the bundled product-owner agent gains:

- Full `Bash` tool access (previously a narrow allowlist of git/gh subcommands).
- A 4-step reality-check protocol at session start: `git branch --show-current` +
  `git log --oneline -5`, read `AGENTS.md` + constitution, read
  `.claude/agents/product-owner/memory/MEMORY.md`, then query the live backlog before answering
  "what's next?".
- An explicit memory-home directive: `.claude/agents/product-owner/memory/` is canonical;
  `.claude/agent-memory/` is never used.

```prompt
On your next session start in a Specflow project, the product-owner agent will run the new reality-check protocol automatically — no migration needed. If you have an existing `.claude/agent-memory/product-owner/` directory from before this upgrade, you can either delete it (the agent will stop reading/writing there now) or `mv` its contents into `.claude/agents/product-owner/memory/`. Files at the legacy path will be ignored.
```
````

🤖 Generated with [Claude Code](https://claude.com/claude-code)

````
Then create the PR:

```bash
jq -n --arg title "fix(agents): widen PO Bash allowlist + add memory-home directive" \
      --rawfile body /tmp/pr-258-body.md \
      '{title: $title, body: $body, head: "fix/po-bash-allowlist-and-memory-home", base: "main"}' \
  | gh api -X POST repos/mkrlabs/specflow/pulls --input - --jq '"#\(.number) \(.html_url)"'
````

Expected: prints `#NNN https://github.com/mkrlabs/specflow/pull/NNN`.

- [ ] **Step 5: Watch CI to green**

```bash
SHA=$(git rev-parse HEAD)
for i in 1 2 3 4 5 6; do
  STATUS=$(gh api "repos/mkrlabs/specflow/commits/$SHA/check-runs" \
    --jq '[.check_runs[] | select(.status != "completed")] | length' 2>/dev/null)
  if [ "$STATUS" = "0" ]; then echo "all done at attempt $i"; break; fi
  echo "attempt $i: $STATUS in-progress, sleeping 30s"
  sleep 30
done
gh api "repos/mkrlabs/specflow/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "-")"'
```

Expected: every check completed with `success` (lint, lint-test, cross-smoke macos/ubuntu/windows,
CodeQL, Analyze, docs-drift, comment-on-linked-issues).

- [ ] **Step 6: Squash-merge via REST**

```bash
gh api -X PUT repos/mkrlabs/specflow/pulls/<NUMBER>/merge -f merge_method=squash \
  --jq '{merged, sha, message}'
```

Expected: `{"merged":true,...}`.

- [ ] **Step 7: Dispatch the product-owner subagent to close #258**

Per Specflow's CLAUDE.md, all backlog mutations go through the PO agent. Dispatch it with this
prompt:

```
Close mkrlabs/specflow#258 with reason: completed. Reference the merged
PR (replace <PR> with the actual PR number returned in Step 4) in the
close comment. Brief summary: tools allowlist widened to full Bash;
First-action protocol expanded with git/MEMORY.md/backlog reality-checks
and explicit memory-home directive; three smoke assertions lock the new
content. Ships via specflow upgrade.
```

Expected: PO closes the issue, board moves to Done, close comment posted.

- [ ] **Step 8: Pull main locally**

```bash
git checkout main && git pull --ff-only
```

Expected: fast-forward to the squash-merge commit.

---

## Verification

End-to-end after all tasks:

1. **Unit tests**: `deno task test` — must be 643+ green (no new unit tests; the smoke layer covers
   the surface change).
2. **Byte-identity**: `tests/plugin/plugin_sync_test.ts` green —
   `templates/core/agents/product-owner.md` byte-identical to `plugin/agents/product-owner.md`.
3. **Windsurf cap**: `tests/infrastructure/harness/windsurf_harness_test.ts --filter "Cascade cap"`
   green — rendered PO file ≤ 12 000 chars.
4. **Smoke**: `bash .claude/skills/test-sandbox/scripts/smoke-features.sh` — three new assertions
   green (tools line, memory-home path, agent-memory negation).
5. **Smoke audit**: `bash .claude/skills/test-sandbox/scripts/audit.sh` — 0 gaps, 0 stale.
6. **Pre-commit hook**: every commit goes through `deno fmt --check`, `deno lint`,
   `deno task bundle`, `deno check src/main.ts` — gates failure before push.

## Out of scope (do NOT do)

- Changing the tool allowlist of any other bundled agent (developer.md is already full-Bash;
  architect.md, qa-tester.md, security-auditor.md, devops-sre.md all need separate analysis — out of
  scope per #258).
- Adding new memory entries to the PO agent's template-shipped MEMORY.md (the file stays empty; the
  agent populates it).
- Adding a "source-of-truth rule" GraphQL query (called out as a separate follow-up in #258's
  `## Notes`).
- Renaming or relocating the memory directory itself (`.claude/agents/<name>/memory/` is the
  convention; this PR documents it, doesn't move it).
- Adding a new PO command or modifying any existing `/backlog *` command body (the issue is strictly
  about tools + memory home directive, not capabilities).
- Updating docs at `docs/llms.md` or the public site — the change is internal to the agent template;
  no user-facing CLI surface changed.

## Failure modes to watch for

1. **Plugin drift fails CI**: if Task 1 Step 2 (the `cp` mirror) is skipped or done wrong,
   `plugin_sync_test.ts` fails with
   `Plugin copy of plugin/agents/product-owner.md has drifted from templates/core/agents/product-owner.md`.
   Fix: re-run the `cp` from source to plugin and recommit.
2. **Windsurf cap overrun**: if Task 2 grows the template past the cap (unlikely given the projected
   52-char headroom but possible if line wrapping bloats), `windsurf_harness_test.ts` fails with
   `exceeds 12000 chars: <N>`. Fix: trim the `### Closing rules (all three backends)` paragraph at
   lines 111-116, specifically the GitHub/GitLab two-step bullet — the densest in the file. Do
   **not** trim the new "First action" content.
3. **Smoke audit reports stale assertion**: if Task 3's grep patterns don't exactly match what Task
   2 wrote (e.g. line-anchored regex `^tools: ...$` mismatching a YAML emitter that adds spaces),
   the smoke test fails with `expected pattern not found`. Fix: adjust the grep pattern in
   `smoke-features.sh` to match the actual emitted form —
   `cat .claude/agents/product-owner.md | head -5` against a fresh init dump tells you the exact
   form.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-po-bash-allowlist-and-memory-home.md`.
Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review (spec
compliance + code quality) between each task. Useful here because the Windsurf-cap headroom is tight
enough that a sloppy edit could blow the budget — the reviewer step catches that before commit.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with
checkpoints. Faster, lower overhead. Appropriate given the 4-task scope and the
verbose-but-mechanical nature of each task.

**Which approach?**
