# Backlog Backend Strategy Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-line `if (backend === "github")` / `if (backend === "gitlab")` branching in
the CLI handlers with a `BacklogBackendStrategy` interface + 3 concrete strategy classes,
eliminating duplication and making the addition of a 4th backend a one-file change.

**Architecture:** New domain module `src/domain/backlog_backend_strategy.ts` defines the
`BacklogBackendStrategy` interface. Three concrete strategies (`LocalBacklogStrategy`,
`GithubBacklogStrategy`, `GitlabBacklogStrategy`) live in `src/domain/backlog_strategies/`. A
registry exposes `findBacklogStrategy(key)`. Call sites (`init_handler.ts`, `parser.ts`,
`backlog_picker.ts`) become thin lookups against the registry instead of multi-branch conditionals.

**Tech Stack:** TypeScript (Deno 2.x), `@std/assert` for tests, existing manifest/bundling pipeline
unchanged.

---

## Context the engineer needs

This refactor sits on top of `BacklogBackend = "local" | "github" | "gitlab"` defined in
`src/domain/installed_lock.ts`. The 3 backends were added across PRs #71 (local + github) and #91
(gitlab). 330 tests pass before this refactor; **the refactor must keep all of them green**, plus
add new unit tests for the strategy classes.

Existing call sites that branch on the backend string today:

1. `src/cli/handlers/init_handler.ts:43-89` — `GITHUB_CONFIG_STUB` constant, `GITLAB_CONFIG_STUB`
   constant, `writeBacklogConfigStub(dir, backend)` switches on `backend === "github"` to pick the
   stub + the messages, then a separate
   `if (backlogBackend === "github" || backlogBackend === "gitlab")` to decide whether to call it at
   all.
2. `src/cli/parser.ts` — two near-identical
   `if (backlogRaw !== null && backlogRaw !== "local" && backlogRaw !== "github" && backlogRaw !== "gitlab")`
   chains, one in the `init` branch, one in the `upgrade` branch.
3. `src/cli/backlog_picker.ts` — `DISPLAY_NAMES: Record<BacklogBackend, string>` is a closed map
   duplicated outside the strategy/registry; not technically an `if`-chain, but it duplicates
   information that should live with each backend.

After the refactor:

- A new file calls `findBacklogStrategy(backend)` once and uses methods on it.
- `KNOWN_BACKLOG_BACKENDS` (already exported from `installed_lock.ts`) becomes the single source of
  truth for valid string values; `parser.ts` uses `KNOWN_BACKLOG_BACKENDS.includes(...)` instead of
  an `&&`-chain.
- Adding a `bitbucket` backend later = one new file in `src/domain/backlog_strategies/`, plus the
  union literal in `installed_lock.ts`.

---

## File structure

| File                                        | Responsibility                                          | Created/Modified |
| ------------------------------------------- | ------------------------------------------------------- | ---------------- |
| `src/domain/backlog_backend_strategy.ts`    | `BacklogBackendStrategy` interface                      | **Create**       |
| `src/domain/backlog_strategies/local.ts`    | `LocalBacklogStrategy`                                  | **Create**       |
| `src/domain/backlog_strategies/github.ts`   | `GithubBacklogStrategy`                                 | **Create**       |
| `src/domain/backlog_strategies/gitlab.ts`   | `GitlabBacklogStrategy`                                 | **Create**       |
| `src/domain/backlog_strategies/registry.ts` | `BACKLOG_STRATEGIES` array + `findBacklogStrategy(key)` | **Create**       |
| `tests/domain/backlog_strategies_test.ts`   | Unit tests for each strategy                            | **Create**       |
| `src/cli/handlers/init_handler.ts`          | Replace inline branches with strategy lookup            | **Modify**       |
| `src/cli/parser.ts`                         | Use `KNOWN_BACKLOG_BACKENDS.includes()`                 | **Modify**       |
| `src/cli/backlog_picker.ts`                 | Read display names from the registry                    | **Modify**       |

No template files change. No manifest changes. No test fixtures change. The `BacklogBackend` union
in `installed_lock.ts` stays as-is — strategies key off it.

---

## Task 1: Define the `BacklogBackendStrategy` interface

**Files:**

- Create: `src/domain/backlog_backend_strategy.ts`
- Test: (none — interface-only file)

- [ ] **Step 1: Create the interface file**

Write `src/domain/backlog_backend_strategy.ts`:

```typescript
import type { BacklogBackend } from "./installed_lock.ts";

/**
 * Strategy interface for a backlog backend. Each backend implements
 * this interface to expose its specific behavior — config-stub
 * contents, init-time messages, display name — without call sites
 * needing to switch on the backend string.
 *
 * To add a new backend:
 *   1. Add the string to `BacklogBackend` in `installed_lock.ts`.
 *   2. Implement `BacklogBackendStrategy` in
 *      `backlog_strategies/<new>.ts`.
 *   3. Register it in `backlog_strategies/registry.ts`.
 */
export interface BacklogBackendStrategy {
  readonly key: BacklogBackend;

  /** Human-readable label shown in the interactive picker. */
  readonly displayName: string;

  /**
   * Returns the contents of `.specflow/backlog-config.yml` to write
   * at init time, or `null` if no config file is needed for this
   * backend (e.g. `local` is zero-config).
   */
  initConfigStub(): string | null;

  /**
   * Returns the lines (already stripped of trailing newlines) to
   * print to the user via `console.log(dim(...))` after a successful
   * init. Empty array = silent. Always emitted in order.
   */
  initConfigMessages(): readonly string[];
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `deno check src/domain/backlog_backend_strategy.ts` Expected: prints
`Check src/domain/backlog_backend_strategy.ts` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domain/backlog_backend_strategy.ts
git commit -m "refactor(backlog): introduce BacklogBackendStrategy interface"
```

---

## Task 2: Implement `LocalBacklogStrategy`

**Files:**

- Create: `src/domain/backlog_strategies/local.ts`
- Test: `tests/domain/backlog_strategies_test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/backlog_strategies_test.ts` with:

```typescript
import { assertEquals } from "@std/assert";
import { LocalBacklogStrategy } from "../../src/domain/backlog_strategies/local.ts";

Deno.test("LocalBacklogStrategy exposes key 'local'", () => {
  const s = new LocalBacklogStrategy();
  assertEquals(s.key, "local");
});

Deno.test("LocalBacklogStrategy displayName mentions Markdown files", () => {
  const s = new LocalBacklogStrategy();
  assertEquals(
    s.displayName.includes("Markdown") || s.displayName.includes("markdown"),
    true,
  );
});

Deno.test("LocalBacklogStrategy.initConfigStub returns null (zero-config)", () => {
  const s = new LocalBacklogStrategy();
  assertEquals(s.initConfigStub(), null);
});

Deno.test("LocalBacklogStrategy.initConfigMessages is empty", () => {
  const s = new LocalBacklogStrategy();
  assertEquals(s.initConfigMessages(), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected: 4 failures with
module-not-found / class-not-defined errors.

- [ ] **Step 3: Implement the strategy**

Create `src/domain/backlog_strategies/local.ts`:

```typescript
import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";

export class LocalBacklogStrategy implements BacklogBackendStrategy {
  readonly key = "local" as const;
  readonly displayName = "Local Markdown files (.specflow/backlog/)";

  initConfigStub(): string | null {
    return null;
  }

  initConfigMessages(): readonly string[] {
    return [];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected:
`4 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog_strategies/local.ts tests/domain/backlog_strategies_test.ts
git commit -m "refactor(backlog): implement LocalBacklogStrategy"
```

---

## Task 3: Implement `GithubBacklogStrategy`

**Files:**

- Create: `src/domain/backlog_strategies/github.ts`
- Modify: `tests/domain/backlog_strategies_test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/domain/backlog_strategies_test.ts`:

```typescript
import { GithubBacklogStrategy } from "../../src/domain/backlog_strategies/github.ts";

Deno.test("GithubBacklogStrategy exposes key 'github'", () => {
  const s = new GithubBacklogStrategy();
  assertEquals(s.key, "github");
});

Deno.test("GithubBacklogStrategy displayName mentions GitHub + gh CLI", () => {
  const s = new GithubBacklogStrategy();
  assertEquals(s.displayName.includes("GitHub"), true);
  assertEquals(s.displayName.includes("gh CLI"), true);
});

Deno.test("GithubBacklogStrategy.initConfigStub contains repo + project_number keys", () => {
  const s = new GithubBacklogStrategy();
  const stub = s.initConfigStub();
  assertEquals(typeof stub, "string");
  if (typeof stub !== "string") return;
  assertEquals(stub.includes("repo:"), true);
  assertEquals(stub.includes("project_number:"), true);
});

Deno.test("GithubBacklogStrategy.initConfigMessages mentions backlog-config.yml + MCP tip", () => {
  const s = new GithubBacklogStrategy();
  const msgs = s.initConfigMessages();
  assertEquals(msgs.length >= 2, true);
  const joined = msgs.join("\n");
  assertEquals(joined.includes("backlog-config.yml"), true);
  assertEquals(joined.includes("MCP"), true);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected: 4 new failures with
module-not-found errors. Existing 4 still pass.

- [ ] **Step 3: Implement the strategy**

Create `src/domain/backlog_strategies/github.ts`:

```typescript
import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";

const CONFIG_STUB = `# backlog-config.yml — generated by \`specflow init --backlog github\`
# Fill in repo + project_number before the PO can run any backlog command.
repo: ""              # e.g. myorg/myproject
project_number: ""    # GitHub Project V2 number
# project_node_id and status_field_id are cached on first run.
project_node_id: ""
status_field_id: ""
`;

export class GithubBacklogStrategy implements BacklogBackendStrategy {
  readonly key = "github" as const;
  readonly displayName = "GitHub Issues + Project (requires gh CLI)";

  initConfigStub(): string {
    return CONFIG_STUB;
  }

  initConfigMessages(): readonly string[] {
    return [
      "↳ wrote .specflow/backlog-config.yml — fill in repo + project_number before running /backlog",
      "  tip: for a richer experience, enable the GitHub MCP connector via `/mcp` in Claude Code",
    ];
  }
}
```

- [ ] **Step 4: Run to verify all 8 tests pass**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected:
`8 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog_strategies/github.ts tests/domain/backlog_strategies_test.ts
git commit -m "refactor(backlog): implement GithubBacklogStrategy"
```

---

## Task 4: Implement `GitlabBacklogStrategy`

**Files:**

- Create: `src/domain/backlog_strategies/gitlab.ts`
- Modify: `tests/domain/backlog_strategies_test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/domain/backlog_strategies_test.ts`:

```typescript
import { GitlabBacklogStrategy } from "../../src/domain/backlog_strategies/gitlab.ts";

Deno.test("GitlabBacklogStrategy exposes key 'gitlab'", () => {
  const s = new GitlabBacklogStrategy();
  assertEquals(s.key, "gitlab");
});

Deno.test("GitlabBacklogStrategy displayName mentions GitLab + glab CLI", () => {
  const s = new GitlabBacklogStrategy();
  assertEquals(s.displayName.includes("GitLab"), true);
  assertEquals(s.displayName.includes("glab CLI"), true);
});

Deno.test("GitlabBacklogStrategy.initConfigStub contains host + project_id keys", () => {
  const s = new GitlabBacklogStrategy();
  const stub = s.initConfigStub();
  assertEquals(typeof stub, "string");
  if (typeof stub !== "string") return;
  assertEquals(stub.includes("host:"), true);
  assertEquals(stub.includes("project_id:"), true);
});

Deno.test("GitlabBacklogStrategy.initConfigMessages mentions glab CLI prerequisite", () => {
  const s = new GitlabBacklogStrategy();
  const msgs = s.initConfigMessages();
  assertEquals(msgs.length >= 2, true);
  const joined = msgs.join("\n");
  assertEquals(joined.includes("backlog-config.yml"), true);
  assertEquals(joined.includes("glab"), true);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected: 4 new failures
(module-not-found). Existing 8 still pass.

- [ ] **Step 3: Implement the strategy**

Create `src/domain/backlog_strategies/gitlab.ts`:

```typescript
import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";

const CONFIG_STUB = `# backlog-config.yml — generated by \`specflow init --backlog gitlab\`
# Fill in host + project_id before the PO can run any backlog command.
host: gitlab.com      # or your self-hosted instance, e.g. gitlab.example.com
project_id: ""        # GitLab project ID (numeric) or path "group/project"
# Status is tracked via scoped labels: Status::Backlog, Status::Ready,
# Status::"In progress", Status::"In review", Status::Done.
`;

export class GitlabBacklogStrategy implements BacklogBackendStrategy {
  readonly key = "gitlab" as const;
  readonly displayName = "GitLab Issues + scoped Status labels (requires glab CLI)";

  initConfigStub(): string {
    return CONFIG_STUB;
  }

  initConfigMessages(): readonly string[] {
    return [
      "↳ wrote .specflow/backlog-config.yml — fill in host + project_id before running /backlog",
      "  prerequisite: install glab CLI (https://gitlab.com/gitlab-org/cli) and run `glab auth login`",
    ];
  }
}
```

- [ ] **Step 4: Run to verify all 12 tests pass**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected:
`12 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog_strategies/gitlab.ts tests/domain/backlog_strategies_test.ts
git commit -m "refactor(backlog): implement GitlabBacklogStrategy"
```

---

## Task 5: Add the registry + `findBacklogStrategy`

**Files:**

- Create: `src/domain/backlog_strategies/registry.ts`
- Modify: `tests/domain/backlog_strategies_test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/domain/backlog_strategies_test.ts`:

```typescript
import { assertThrows } from "@std/assert";
import {
  BACKLOG_STRATEGIES,
  findBacklogStrategy,
} from "../../src/domain/backlog_strategies/registry.ts";
import { KNOWN_BACKLOG_BACKENDS } from "../../src/domain/installed_lock.ts";

Deno.test("BACKLOG_STRATEGIES covers every value of KNOWN_BACKLOG_BACKENDS", () => {
  const registryKeys = BACKLOG_STRATEGIES.map((s) => s.key).sort();
  const knownKeys = [...KNOWN_BACKLOG_BACKENDS].sort();
  assertEquals(registryKeys, knownKeys);
});

Deno.test("findBacklogStrategy returns the local strategy for 'local'", () => {
  const s = findBacklogStrategy("local");
  assertEquals(s.key, "local");
});

Deno.test("findBacklogStrategy returns the github strategy for 'github'", () => {
  const s = findBacklogStrategy("github");
  assertEquals(s.key, "github");
});

Deno.test("findBacklogStrategy returns the gitlab strategy for 'gitlab'", () => {
  const s = findBacklogStrategy("gitlab");
  assertEquals(s.key, "gitlab");
});

Deno.test("findBacklogStrategy throws on an unknown backend", () => {
  // Cast to bypass the type system so we can simulate a corrupt lock.
  assertThrows(
    () => findBacklogStrategy("bitbucket" as never),
    Error,
    "unknown backlog backend",
  );
});
```

- [ ] **Step 2: Run to verify the 5 new tests fail**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected: 5 new failures. The
12 existing pass.

- [ ] **Step 3: Implement the registry**

Create `src/domain/backlog_strategies/registry.ts`:

```typescript
import type { BacklogBackend } from "../installed_lock.ts";
import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";
import { LocalBacklogStrategy } from "./local.ts";
import { GithubBacklogStrategy } from "./github.ts";
import { GitlabBacklogStrategy } from "./gitlab.ts";

export const BACKLOG_STRATEGIES: ReadonlyArray<BacklogBackendStrategy> = [
  new LocalBacklogStrategy(),
  new GithubBacklogStrategy(),
  new GitlabBacklogStrategy(),
];

/**
 * Returns the strategy for the given backend key.
 *
 * Throws when `key` is not a known backend — this should never happen
 * with a well-formed lock, but defends against typos / corrupt locks
 * without silently picking the wrong strategy.
 */
export function findBacklogStrategy(
  key: BacklogBackend,
): BacklogBackendStrategy {
  const s = BACKLOG_STRATEGIES.find((s) => s.key === key);
  if (!s) {
    throw new Error(`unknown backlog backend: ${String(key)}`);
  }
  return s;
}
```

- [ ] **Step 4: Run to verify all 17 strategy tests pass**

Run: `deno test --allow-read tests/domain/backlog_strategies_test.ts` Expected:
`17 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog_strategies/registry.ts tests/domain/backlog_strategies_test.ts
git commit -m "refactor(backlog): add strategy registry + findBacklogStrategy"
```

---

## Task 6: Refactor `init_handler.ts` to use the registry

**Files:**

- Modify: `src/cli/handlers/init_handler.ts`

The current code has two top-level constants (`GITHUB_CONFIG_STUB`, `GITLAB_CONFIG_STUB`), an
`if (backend === "github") ... else` ternary inside `writeBacklogConfigStub`, two distinct
`console.log` paths for the two backends, and a caller-side
`if (backlogBackend === "github" || backlogBackend === "gitlab")`. After this task: zero of those
inline branches remain; the function reads the strategy and dispatches.

- [ ] **Step 1: Replace the body of `init_handler.ts`'s backlog-stub section**

Open `src/cli/handlers/init_handler.ts`. Find the block starting with `const GITHUB_CONFIG_STUB =`
and ending at the closing `}` of `writeBacklogConfigStub`. Replace it (the entire block, both
constants and the function) with:

```typescript
import { findBacklogStrategy } from "../../domain/backlog_strategies/registry.ts";

async function writeBacklogConfigStub(
  targetDir: string,
  backend: BacklogBackend,
): Promise<void> {
  const strategy = findBacklogStrategy(backend);
  const stub = strategy.initConfigStub();
  if (stub === null) return; // local: zero-config, nothing to write

  const path = `${targetDir}/.specflow/backlog-config.yml`;
  try {
    await Deno.stat(path);
    return; // don't clobber an existing config
  } catch {
    // not present → write the stub
  }
  await Deno.mkdir(`${targetDir}/.specflow`, { recursive: true });
  await Deno.writeTextFile(path, stub);
  for (const msg of strategy.initConfigMessages()) {
    console.log(dim(msg));
  }
}
```

(The `BacklogBackend` import already exists at the top of the file from prior work — don't add it
twice. The `findBacklogStrategy` import is new; place it alongside the other domain imports.)

- [ ] **Step 2: Replace the caller-side conditional**

In the same file, find the call site:

```typescript
if (backlogBackend === "github" || backlogBackend === "gitlab") {
  await writeBacklogConfigStub(targetDir, backlogBackend);
}
```

Replace with the unconditional call (the strategy decides whether to write):

```typescript
await writeBacklogConfigStub(targetDir, backlogBackend);
```

- [ ] **Step 3: Run the type-check**

Run: `deno check src/main.ts` Expected: `Check src/main.ts` with no errors.

- [ ] **Step 4: Run the full test suite**

Run: `deno task test` Expected: `330 passed | 0 failed` (count unchanged from before this refactor —
the integration tests that exercise `init --backlog github` and `init --backlog gitlab` should still
pass identically because the strategy reproduces the same content + messages).

- [ ] **Step 5: Commit**

```bash
git add src/cli/handlers/init_handler.ts
git commit -m "refactor(init): replace backlog-stub branches with strategy lookup"
```

---

## Task 7: Refactor `parser.ts` to use `KNOWN_BACKLOG_BACKENDS.includes()`

**Files:**

- Modify: `src/cli/parser.ts`

The parser today has two near-identical 5-line `&&`-chains validating `backlogRaw`. They diverge
only on the `received:` error message prefix (`init` vs `upgrade`). After this task: a single helper
using `KNOWN_BACKLOG_BACKENDS` does the validation; the call sites pick the prefix.

- [ ] **Step 1: Add a private validator helper**

In `src/cli/parser.ts`, near the top (after imports, before `export function parseArgs`), add:

```typescript
import { KNOWN_BACKLOG_BACKENDS } from "../domain/installed_lock.ts";

function validateBacklogArg(
  raw: string | null,
): { ok: true; value: "local" | "github" | "gitlab" | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if ((KNOWN_BACKLOG_BACKENDS as ReadonlyArray<string>).includes(raw)) {
    return { ok: true, value: raw as "local" | "github" | "gitlab" };
  }
  return { ok: false };
}
```

(Cast to `ReadonlyArray<string>` is the standard idiom for `Array.includes` on a typed-literal array
— TS narrows the parameter to the union type otherwise and rejects an arbitrary `string`.)

- [ ] **Step 2: Replace the init-command validation**

In the same file, find the block inside `if (command === "init") {`:

```typescript
const backlogProvided = typeof parsed.backlog === "string";
const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
if (
  backlogRaw !== null &&
  backlogRaw !== "local" &&
  backlogRaw !== "github" &&
  backlogRaw !== "gitlab"
) {
  return { kind: "unknown", received: `init --backlog ${backlogRaw}` };
}
```

Replace with:

```typescript
const backlogProvided = typeof parsed.backlog === "string";
const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
const backlogResult = validateBacklogArg(backlogRaw);
if (!backlogResult.ok) {
  return { kind: "unknown", received: `init --backlog ${backlogRaw}` };
}
```

Then in the `return { kind: "init", ..., backlog: backlogRaw, ... }` literal a few lines below,
replace `backlog: backlogRaw,` with `backlog: backlogResult.value,`.

- [ ] **Step 3: Replace the upgrade-command validation**

Same idea, inside `if (command === "upgrade") {`:

```typescript
const backlogProvided = typeof parsed.backlog === "string";
const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
if (
  backlogRaw !== null &&
  backlogRaw !== "local" &&
  backlogRaw !== "github" &&
  backlogRaw !== "gitlab"
) {
  return { kind: "unknown", received: `upgrade --backlog ${backlogRaw}` };
}
```

becomes:

```typescript
const backlogProvided = typeof parsed.backlog === "string";
const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
const backlogResult = validateBacklogArg(backlogRaw);
if (!backlogResult.ok) {
  return { kind: "unknown", received: `upgrade --backlog ${backlogRaw}` };
}
```

And in the upgrade `return { kind: "upgrade", ..., backlog: backlogRaw }` literal, change
`backlog: backlogRaw,` to `backlog: backlogResult.value,`.

- [ ] **Step 4: Run type-check and tests**

Run: `deno check src/main.ts && deno task test` Expected: type-check passes; **all 330 tests pass**,
including the parser tests at `tests/cli/parser_test.ts:155-190` that exercise `local` / `github` /
`gitlab` / unknown values.

- [ ] **Step 5: Commit**

```bash
git add src/cli/parser.ts
git commit -m "refactor(parser): validate --backlog via KNOWN_BACKLOG_BACKENDS"
```

---

## Task 8: Refactor `backlog_picker.ts` to source display names from the registry

**Files:**

- Modify: `src/cli/backlog_picker.ts`

Today `backlog_picker.ts` has its own `DISPLAY_NAMES: Record<BacklogBackend, string>` hard-coded
with strings that mirror what each strategy already exposes via `displayName`. After this task: the
picker iterates `BACKLOG_STRATEGIES` and reads `displayName` from each.

- [ ] **Step 1: Replace the picker's body**

Open `src/cli/backlog_picker.ts`. Replace the entire file with:

```typescript
import { type BacklogBackend } from "../domain/installed_lock.ts";
import { BACKLOG_STRATEGIES } from "../domain/backlog_strategies/registry.ts";

export const DEFAULT_BACKLOG_BACKEND: BacklogBackend = "local";

export type BacklogPickerIO = {
  readLine: () => string | null;
  log: (s: string) => void;
  errLog: (s: string) => void;
};

export function pickBacklogBackend(io: BacklogPickerIO): BacklogBackend {
  io.log("Choose your backlog backend (press Enter for default):");
  for (let i = 0; i < BACKLOG_STRATEGIES.length; i++) {
    const s = BACKLOG_STRATEGIES[i];
    const marker = s.key === DEFAULT_BACKLOG_BACKEND ? " (default)" : "";
    io.log(`  ${i + 1}) ${s.displayName}${marker}`);
  }
  while (true) {
    const raw = (io.readLine() ?? "").trim();
    if (raw === "") return DEFAULT_BACKLOG_BACKEND;
    const idx = parseInt(raw, 10) - 1;
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < BACKLOG_STRATEGIES.length
    ) {
      return BACKLOG_STRATEGIES[idx].key;
    }
    io.errLog(
      `invalid choice "${raw}" — expected 1-${BACKLOG_STRATEGIES.length} or empty for default`,
    );
  }
}
```

Note the change: the old file imported `KNOWN_BACKLOG_BACKENDS` and looked up display names from a
separate constant; the new file iterates the strategy registry directly. The `key` returned at the
end of `pickBacklogBackend` is `BACKLOG_STRATEGIES[idx].key`, not a separate string — single source
of truth.

- [ ] **Step 2: Run the picker tests**

Run: `deno test --allow-read tests/cli/backlog_picker_test.ts` Expected: `5 passed | 0 failed` (the
4 original tests from #69 + the gitlab test added in #70 should all still pass — input/output
behavior is identical).

- [ ] **Step 3: Run the full suite**

Run: `deno task test` Expected: **all 330 tests pass + 17 new strategy tests = 347 passed**.

- [ ] **Step 4: Commit**

```bash
git add src/cli/backlog_picker.ts
git commit -m "refactor(picker): read display names from BACKLOG_STRATEGIES registry"
```

---

## Task 9: End-to-end validation via test-sandbox + open the PR

**Files:** none modified — verification + PR.

- [ ] **Step 1: Bootstrap a Vite scenario and exercise all 3 backends**

Run, from the repo root:

```bash
bash .claude/skills/test-sandbox/scripts/clean.sh
bash .claude/skills/test-sandbox/scripts/bootstrap-vite.sh refactor-local
cd sandbox/refactor-local
deno run --allow-all ../../src/main.ts init --here --no-git --ai claude --backlog local
test ! -f .specflow/backlog-config.yml || (echo "FAIL: local should not write a config stub"; exit 1)
echo "✓ local: no stub written"
cd /Users/kevin/Sites/specflow
```

Expected: prints `✓ local: no stub written`, exits 0.

- [ ] **Step 2: Same for github and gitlab**

Run, from the repo root:

```bash
bash .claude/skills/test-sandbox/scripts/clean.sh
bash .claude/skills/test-sandbox/scripts/bootstrap-vite.sh refactor-github
cd sandbox/refactor-github
deno run --allow-all ../../src/main.ts init --here --no-git --ai claude --backlog github 2>&1 | grep -q "MCP connector" && echo "✓ github: MCP tip emitted"
grep -q "repo:" .specflow/backlog-config.yml && echo "✓ github: stub has repo key"
cd /Users/kevin/Sites/specflow

bash .claude/skills/test-sandbox/scripts/clean.sh
bash .claude/skills/test-sandbox/scripts/bootstrap-vite.sh refactor-gitlab
cd sandbox/refactor-gitlab
deno run --allow-all ../../src/main.ts init --here --no-git --ai claude --backlog gitlab 2>&1 | grep -q "glab CLI" && echo "✓ gitlab: glab tip emitted"
grep -q "host:" .specflow/backlog-config.yml && echo "✓ gitlab: stub has host key"
cd /Users/kevin/Sites/specflow

bash .claude/skills/test-sandbox/scripts/clean.sh
```

Expected: 4 `✓` lines printed, no errors.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin <branch-name>` (The branch was created at the start of this plan's
execution; substitute the actual name.)

- [ ] **Step 4: Open the PR**

Run:

```bash
gh pr create --title "refactor(backlog): introduce BacklogBackendStrategy + registry" --body "$(cat <<'EOF'
## Summary

Replaces the inline branching on \`backend === \"github\"\` / \`backend === \"gitlab\"\` in the CLI handlers with a \`BacklogBackendStrategy\` interface + 3 concrete strategy classes. Adding a 4th backend later (e.g. Bitbucket) becomes a single new file in \`src/domain/backlog_strategies/\` plus the union literal in \`installed_lock.ts\` — no changes to call sites.

## What ships

- \`src/domain/backlog_backend_strategy.ts\` — interface
- \`src/domain/backlog_strategies/{local,github,gitlab,registry}.ts\` — 3 strategies + registry with \`findBacklogStrategy(key)\`
- \`tests/domain/backlog_strategies_test.ts\` — 17 unit tests covering each strategy + the registry

## What gets simpler

- \`init_handler.ts\` — 2 top-level config-stub constants + 2 multi-line \`if/else\` branches → single \`findBacklogStrategy(...).initConfigStub()\` call
- \`parser.ts\` — two near-identical 5-line \`&&\`-chains → one \`validateBacklogArg\` helper using \`KNOWN_BACKLOG_BACKENDS.includes()\`
- \`backlog_picker.ts\` — duplicated \`DISPLAY_NAMES: Record<...>\` removed; picker iterates \`BACKLOG_STRATEGIES\` directly

## Tests

- 17 new strategy tests
- All 330 existing tests still pass (no behavior change)
- End-to-end validated via test-sandbox: \`init --backlog local|github|gitlab\` produces identical output to before the refactor

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints the PR URL.

- [ ] **Step 5: Watch CI + merge**

Run: `gh pr checks <PR#> --watch --fail-fast` Expected: 4/4 green (lint-test + 3 cross-smoke).

Then:
`gh pr merge <PR#> --squash --delete-branch && git checkout main && git pull --ff-only origin main`

---

## Self-review notes

- **Spec coverage** — the plan covers every place that branches on the backend string today
  (init_handler, parser, picker). The harness `Harness` interface already implements Strategy and is
  intentionally out of scope. The per-harness category switches are also out of scope (would
  multiply class count by 9 with no clean win).
- **No placeholders** — every step shows the exact code/commands. No "similar to Task N", no "fill
  in details", no "add appropriate error handling".
- **Type consistency** — `BacklogBackendStrategy` is the same name in the interface, all 3
  implementations, the registry, and every test. `findBacklogStrategy` is the same name in the
  registry, the tests, and the call sites in `init_handler.ts`.
- **TDD discipline** — every strategy task is write-failing-test → implement → re-run → green. The
  refactor tasks (init_handler, parser, picker) don't introduce new behavior, so their TDD
  discipline is "modify in small steps + run the existing 330 tests after each step to confirm
  green".
- **Frequent commits** — 1 commit per task, 9 commits total for the whole refactor. Each is a
  working, reviewable unit.
