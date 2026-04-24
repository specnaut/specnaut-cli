# Specflow `backlog sync` — Design

**Date**: 2026-04-24 **Status**: draft, pending review **Component**: 4 of v0.1 post-init (deferred
from v0.1-init plan) **Prerequisites**: v0.1-init merged on `main` (commit `d890a9b`)

---

## 1. Goals and non-goals

### Goals

1. Complete **delta #3** (product backlog) by enabling synchronization of `tasks/backlog/NNN-*.md`
   files to a remote tracker (GitHub Issues + Project V2 in v1).
2. Add two CLI subcommands to the Specflow binary:
   - `specflow backlog sync [--id NNN] [--dry-run]`
   - `specflow backlog configure` (interactive onboarding)
3. Persist configuration in a versioned `.specflow/config.yml` file.
4. Zero token management on the user side — delegate auth to **`gh` CLI** (known prerequisite,
   already in the ecosystem).
5. Strict adherence to hexagonal DDD already in place (domain / application / infrastructure / cli).

### Non-goals

- **Bidirectional sync** (reverse MD ← GitHub) — deferred to v0.2.
- **GitLab / Bitbucket adapters** — deferred to v0.3 (the `BacklogSyncTarget` port will be designed
  to support them).
- **GitHub token management without `gh`** — if `gh` is not authenticated, emit an explicit error
  with instructions.
- **Drift detection** (issue edited manually in GitHub UI) — we overwrite, MD wins.
- **Multi-project support** — one Project V2 per config.
- **Automatic Project V2 creation** — assume the user has already created it in GitHub UI or via
  `gh`.

---

## 2. CLI Surface

### `specflow backlog configure`

Interactive flow:

1. Read `tasks/backlog/` to confirm we are in a Specflow project. If missing → clear error.
2. Detect GitHub repo via `git remote get-url origin`. If not a GitHub repo → error.
3. Verify `gh auth status`. If not authenticated → instruction `gh auth login`.
4. List accessible Projects V2 (personal + owner's repo) via `gh api graphql`.
5. Prompt: `Which project?` (multiple choice) OR `[N] No project — issues only`.
6. For the chosen Project, detect fields (SingleSelect `Status`, Number `Priority`, Number
   `Complexity`) and offer mapping.
7. Write `.specflow/config.yml` + add to `.gitignore` nothing more (the file is public).

### `specflow backlog sync [--id NNN] [--dry-run]`

1. Read `.specflow/config.yml`. If missing → `run 'specflow backlog configure' first`.
2. If `--id NNN` → sync a single task. Otherwise → sync all tasks present in `tasks/backlog/`.
3. For each task:
   - Parse frontmatter + body.
   - Search for existing issue via label `backlog/NNN`.
   - If absent → create. If present → update.
   - Attach to configured Project V2 and populate the 3 mapped fields (Status, Priority,
     Complexity).
   - If status = `done` → close the issue; if `deferred` → close with `not_planned` reason;
     otherwise keep open.
4. `--dry-run`: display the plan (CREATE / UPDATE / CLOSE / SKIP) without calling `gh`.
5. Exit code 0 = all OK (or dry-run), 1 = at least one task failed (others were still attempted,
   cumulative log at end of execution), 2 = missing precondition (no config, no `gh`, etc.).

---

## 3. DDD Architecture

```
src/
├── domain/
│   ├── backlog/
│   │   ├── task.ts             # BacklogTask entity, BacklogTaskId, Priority, Complexity, Status
│   │   ├── frontmatter.ts      # pure parser MD frontmatter → BacklogTask
│   │   └── sync_plan.ts        # value object: list of actions (Create|Update|Close|Skip)
│   └── sync_config.ts          # SyncConfig value object + loader/validator
├── application/
│   ├── ports.ts                # ADD: BacklogReader, BacklogSyncTarget, ConfigStore, InteractivePrompt
│   ├── sync_backlog.ts         # SyncBacklogUseCase (read MD, diff, apply via target)
│   └── configure_sync.ts       # ConfigureSyncUseCase (interactive setup, writes config)
├── infrastructure/
│   ├── fs_backlog_reader.ts    # FsBacklogReader implementing BacklogReader via walk tasks/backlog/
│   ├── fs_config_store.ts      # FsConfigStore via @std/yaml on .specflow/config.yml
│   ├── gh_cli.ts               # thin wrapper around `Deno.Command("gh", ...)`
│   ├── github_backlog_sync.ts  # GitHubBacklogSyncTarget (Issues REST + Project V2 GraphQL via gh)
│   └── terminal_prompt.ts      # InteractivePrompt via @std/cli/unstable_prompt_select
└── cli/
    ├── parser.ts               # ADD: `backlog` intent with subcommand (sync | configure)
    └── handlers/
        ├── backlog_sync_handler.ts
        └── backlog_configure_handler.ts
```

Mirrored tests: `tests/domain/backlog/*_test.ts`, `tests/application/sync_backlog_test.ts`,
`tests/application/configure_sync_test.ts`, `tests/infrastructure/fs_backlog_reader_test.ts`,
`tests/infrastructure/fs_config_store_test.ts`, `tests/infrastructure/gh_cli_test.ts` (against
mock), `tests/cli/parser_test.ts` (extended).

---

## 4. Data Model (domain)

### `BacklogTask`

```typescript
type Priority = "critical" | "high" | "medium" | "low";
type Status = "todo" | "in_progress" | "done" | "deferred" | "blocked";
type Complexity = 1 | 2 | 3 | 5 | 8 | 13 | 21; // Fibonacci

class BacklogTask {
  constructor(
    readonly id: string, // zero-padded 3-digit
    readonly title: string,
    readonly category: string,
    readonly priority: Priority,
    readonly complexity: Complexity,
    readonly status: Status,
    readonly dependsOn: ReadonlyArray<string>,
    readonly spec: string | null,
    readonly tags: ReadonlyArray<string>,
    readonly created: string, // YYYY-MM-DD
    readonly body: string, // markdown body minus frontmatter
  ) {}
}
```

### `SyncConfig` (persisted in `.specflow/config.yml`)

```yaml
version: 1
sync:
  provider: github
  repo: owner/name # inferred, user-overridable
  project:
    number: 3
    owner: owner # user or org
    field_map:
      status: Status
      priority: Priority
      complexity: Complexity
  label_prefix: backlog/ # default, configurable
```

### `SyncPlan`

```typescript
type SyncAction =
  | { kind: "create"; task: BacklogTask }
  | { kind: "update"; task: BacklogTask; issueNumber: number }
  | { kind: "close"; task: BacklogTask; issueNumber: number; reason: "completed" | "not_planned" }
  | { kind: "skip"; task: BacklogTask; reason: string };

type SyncPlan = ReadonlyArray<SyncAction>;
```

---

## 5. Data flow — `specflow backlog sync`

```
┌─ CLI handler (backlog_sync_handler.ts)
│   └─ loads ConfigStore.read() → SyncConfig
│       └─ if missing → exit 2 with "run configure"
│
├─ SyncBacklogUseCase.execute(config)
│   ├─ BacklogReader.readAll(tasksDir) → BacklogTask[]
│   ├─ BacklogSyncTarget.listExisting(config) → Map<id, issue>
│   ├─ diff(tasks, existing) → SyncPlan
│   ├─ if dryRun: return plan (no side effects)
│   └─ for each action: BacklogSyncTarget.apply(action, config)
│
└─ Handler renders:
    ✓ NNN created → issue #42
    ✓ NNN updated → issue #17
    ↓ NNN closed (done) → issue #12
    ⚠ NNN skipped (invalid frontmatter)
```

### Diff rule (deciding `update` vs `skip`)

In v1, we keep it simple: for any existing task (label `backlog/NNN` found), we always emit an
`update` action — NO content comparison. Reasons: (a) GitHub does not return a hash we could compare
against the formatted MD body, (b) `gh issue edit` operations are idempotent on the server (no
notification if nothing changes). Idempotence test (§12.3) will verify that these "empty" updates
have no observable effect.

Exceptions that emit `skip`:

- Invalid frontmatter (we cannot sync a task we cannot parse).
- Secret detection in body (see §9).

Exception that emits `close`:

- Status = `done` (reason `completed`).
- Status = `deferred` (reason `not_planned`).

### `BacklogSyncTarget` Interface

```typescript
export interface BacklogSyncTarget {
  listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>>;
  apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult>;
}

type ExistingIssue = { id: string; number: number; state: "open" | "closed" };
type ApplyResult = { ok: true; issueNumber: number } | { ok: false; error: string };
```

The `GitHubBacklogSyncTarget` implementation shells out to `gh`:

- `listExisting` → `gh issue list --label "backlog/*" --state all --json number,labels,state` then
  filter labels `backlog/\d{3}`.
- `apply(create)` →
  `gh issue create --title ... --body ... --label backlog/NNN,priority/<x>,category/<y>` then
  GraphQL for Project V2.
- `apply(update)` → `gh issue edit <num> --title ... --body ... --add-label ...`
- `apply(close)` → `gh issue close <num> --reason completed|not_planned`
- Project V2: always via `gh api graphql` (no REST equivalent), with mutations
  `addProjectV2ItemById` and `updateProjectV2ItemFieldValue`.

---

## 6. Configure flow — `specflow backlog configure`

```
1. verify tasks/backlog/ exists           [else → exit 2]
2. read git remote origin                  [parse owner/repo from URL]
3. exec 'gh auth status'                   [else → exit 2 + instructions]
4. exec 'gh api graphql -f query=...'      [list accessible Projects V2]
5. prompt: choose project (or 'none')
6. if chosen, list fields of that project  [via GraphQL]
7. prompt: map 'Status', 'Priority', 'Complexity'  [3 choices; default = field with matching name]
8. write .specflow/config.yml              [@std/yaml]
9. echo: "config written. run 'specflow backlog sync' to sync your current backlog."
```

Non-interactive mode (for CI / scripts): flags `--repo`, `--project-number`, `--project-owner`,
`--skip-prompts`. If provided, no prompts.

---

## 7. Error Handling

| Situation                                                        | Behavior                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No `gh` in PATH                                                  | exit 2 with message `gh CLI required. Install from https://cli.github.com then 'gh auth login'`. |
| `gh auth status` fail                                            | exit 2 with `Run 'gh auth login' first`.                                                         |
| No config file                                                   | `sync` exit 2 with `Run 'specflow backlog configure' first`.                                     |
| Invalid frontmatter in a task                                    | Action `skip` with reason, continue others, exit 1 at end.                                       |
| GitHub API rate-limited                                          | `gh` handles retry; we relay its exit code. No custom retry in v1.                               |
| Project V2 inaccessible (token scope insufficient)               | Explicit message, exit 1 (issues are still created).                                             |
| File `tasks/backlog/NNN-slug.md` where `id` does not match `NNN` | Warning log, sync with frontmatter id (source of truth).                                         |

---

## 8. Tests by Layer

### Domain (pure)

- `frontmatter_test.ts`: parse valid cases, reject missing fields, reject bad enum values,
  round-trip.
- `task_test.ts`: invariants (priority enum, Fibonacci complexity, date format).
- `sync_plan_test.ts`: diff algorithm (existing vs tasks → actions), status transitions.
- `sync_config_test.ts`: YAML parse + validation, version-mismatch error.

### Application (fake ports)

- `sync_backlog_test.ts`: happy path, dry-run, skip invalid, close→done, close→deferred, mixed
  outcomes.
- `configure_sync_test.ts`: interactive flow with fake InteractivePrompt returning canned answers.

### Infrastructure (real Deno APIs, mocked subprocess)

- `fs_backlog_reader_test.ts`: walks a tmp `tasks/backlog/` tree, returns parsed tasks.
- `fs_config_store_test.ts`: read/write round-trip to `.specflow/config.yml`.
- `gh_cli_test.ts`: wraps a fake `Deno.Command` (via a port) so we can assert commands and
  responses.
- `github_backlog_sync_test.ts`: depends on gh_cli fake, verifies the command shapes for
  create/update/close/list.

### Integration

- `backlog_sync_test.ts`: spawn real `specflow` binary in a tmp dir with a mock-gh shim on PATH (a
  bash script that records its args and prints canned JSON). Verifies exit codes, dry-run output,
  config gating.

Target count: ~30 new tests, bringing total from 50 to ~80.

---

## 9. Security Considerations

- **Auth confined to `gh`**: Specflow never touches a GitHub token directly, never reads one, never
  persists one.
- **Network allowlist unchanged** — Specflow continues to need only `api.github.com,github.com,…`
  (for self-update). For sync, it does NOT make direct `fetch` calls to GitHub: everything goes
  through `gh` via subprocess, so only `--allow-run=gh` is needed. No additions to the embedded
  `--allow-net` list at compile time.
- **Injection**: titles/body are passed to `gh` via `--title` / `--body-file` (temp file), never
  concatenated into a shell string. `--body-file` avoids quoting issues.
- **Secrets in MD**: we scan tasks for obvious patterns (`ghp_*`, `sk_*`, AWS keys) before uploading
  and refuse sync if detected, with an `--allow-secrets` option to override.

---

## 10. Contracts with the `product-owner` Agent

The `templates/claude/agents/product-owner.md` template already mentions:

> ### `/backlog sync` and `/backlog sync <id>`
>
> Not yet available in this Specflow version. Tell the user: ...

On delivery of this component, update this template to replace with:

> Runs `specflow backlog sync` (or `sync --id NNN`) as a shell command. After every mutation from
> `add`/`update`/`groom`, the PO must emit the directive "run `specflow backlog sync --id NNN`" so
> the orchestrator executes it.

Consistent update in the `templates/claude/commands/backlog.md` command as well.

Note: the **embedded bundle changes**, so `TEMPLATES_VERSION` in `deno.json` and
`src/domain/version.ts` goes from `0.1.0` to `0.2.0`. The binary version can stay `0.1.0-alpha.N` or
move to `0.2.0` depending on release strategy — to be decided at tag time.

---

## 11. Delivery Plan (to be transformed into implementation plan)

Components in dependency order:

1. **Domain** — task, frontmatter parser, sync_plan, sync_config (+ all domain tests)
2. **Application ports** — add BacklogReader, BacklogSyncTarget, ConfigStore, InteractivePrompt
3. **FsBacklogReader + FsConfigStore** — low-level infrastructure
4. **SyncBacklogUseCase + application tests** with fakes
5. **gh_cli + GitHubBacklogSyncTarget + tests** with subprocess fake
6. **ConfigureSyncUseCase + TerminalPrompt + tests**
7. **CLI parser extension + handlers** (sync + configure)
8. **Main.ts routing**
9. **Integration test** with gh shim
10. **Template updates** (product-owner agent + backlog command refs)
11. **Bump TEMPLATES_VERSION**

---

## 12. Risks and Open Questions

1. **Project V2 GraphQL complexity**: the mutations `updateProjectV2ItemFieldValue` vary by field
   type (`SingleSelect` requires `optionId`, `Number` requires `number`). The adapter must detect
   field type and formulate the corresponding mutation. → Covered by unit tests.
2. **Rate limiting**: on a backlog of 100 tasks, we make ~300 API calls (list + create + project
   attach). `gh` has rate-limit handling; we do nothing special in v1.
3. **Idempotence**: the second run of sync on an already-synced backlog must be a no-op (no
   modifications). Dedicated test needed.
4. **Config file path**: `.specflow/config.yml` created automatically. Should we add it to
   `.gitignore` by default? → No, it must be versioned (decided §1).
5. **Interactive prompt in `configure`**: `@std/cli/unstable_prompt_select` is still tagged
   unstable. Alternative: prompt manually via `readLine`. → We go with `@std/cli/unstable-*` and
   note the dependency on stdlib evolution.

---

## 13. Next Step

After validation of this design, move to `superpowers:writing-plans` to produce the implementation
plan split into ~14 tasks (estimated) following the order in §11.
