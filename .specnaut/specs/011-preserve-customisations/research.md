# Research — Preserve per-project customisations across template refreshes

Phase 0 decisions for issue #367. Grounded in the architect design pass (agent `a337df927febff143`)
against the real code: `src/domain/upgrade_plan.ts`,
`src/application/{init_project,upgrade_project}.ts`,
`src/cli/handlers/{init_handler,upgrade_handler}.ts`,
`src/domain/{installed_lock,merge_block,diff}.ts`, `src/infrastructure/fs_lock_store.ts`.

## D1 — Declaration mechanism: a single `.specnaut/preserve.yml` manifest

**Decision**: A flat YAML list of project-relative paths at `.specnaut/preserve.yml`:

```yaml
preserved:
  - .claude/agents/product-owner.md
  - .claude/agents/developer.md
```

**Rationale**: One file to commit, `cat`, and parse; version-controlled next to `installed.lock`;
invisible to harnesses. It is pure intent — no SHA, no timestamp (those live in the lock).

**Alternatives considered**: (a) per-file frontmatter (`specflow_preserve: true`) — rejected: the
managed bundle contains non-markdown files (`.gitignore`, shell scripts, JSON stubs) that have no
frontmatter, forcing a special-case scheme; (b) per-file `.specnaut-override` sidecars — rejected:
doubles the file count and the declaration is invisible to a reviewer scanning the file it protects.

## D2 — Preserve intent lives in its own file, not in `installed.lock`

**Decision**: Keep declarations in `.specnaut/preserve.yml`; do NOT embed them in `InstalledLock`.

**Rationale**: The lock is a **state record** (SHAs, installed-at, templates version); the manifest
is a **user-intent record**. A maintainer editing preserves must not have to understand or hand-edit
the lock format. The `parentManaged` precedent embeds a _derived fact_ in the lock; preserve
declarations are _deliberate intent_ — a different concern that deserves its own file. Keeping the
lock format unchanged also preserves backward compatibility for free.

**Alternatives considered**: a `preserved: string[]` key on the lock — rejected: couples intent to
state and complicates hand-editing.

## D3 — Injection point: init filters the write set; upgrade gains a predicate

**Decision**: `init --force` does **not** route through `computeUpgradePlan` — it calls
`writer.writeBundle(bundle, targetDir, {overwrite:true, backupExisting:true})` directly. So the
preserve filter is applied in `InitProjectUseCase.execute`: build `bundleToWrite` by removing the
declared-preserved paths from `bundle` before the `writeBundle` call, and return the skipped set in
`InitResult.preserved`. `upgrade` already respects `computeUpgradePlan`'s `preserve` action, so it
only needs the plan to _emit_ `preserve` for declared paths — via a new
`UpgradePlanOptions.isDeclaredPreserved?: (dest) => boolean` predicate.

**Rationale**: Injecting at each path's actual decision site is the smallest correct change and
keeps both paths honouring the same `PreserveStore`. The predicate mirrors the existing
`isPluginCoveredPath` seam (a pure predicate imported by the use case, not by the domain).

**Alternatives considered**: routing `init --force` through `computeUpgradePlan` — rejected: a much
larger refactor of the init path for no behavioural gain; the two commands have legitimately
different write strategies.

## D4 — `preserve.reason` gains a `"declared"` variant; ordering matters

**Decision**: Extend the union to `preserve; reason: "customized" | "declared"; pluginAvailable`. In
`computeUpgradePlan`, check `isDeclaredPreserved(dest)` **before** the
`diskSha === newSha → unchanged` branch AND **before** the plugin-migration branch, emitting
`preserve / reason:"declared"` when true.

**Rationale**: A declared file must be preserved even when it currently matches the bundle (FR-007)
and must not be migrated away to the plugin (spec edge case: "preservation takes precedence over
migration"). Ordering the declared check first is what guarantees both. Customised+covered files
keep their existing `reason:"customized"; pluginAvailable:true` handling.

**Alternatives considered**: a separate `declared-preserve` action kind — rejected: the handler
already renders `preserve`; a new `reason` value reuses that rendering and the existing skip-notice
path with a one-word change.

## D5 — `specflow diff` is a net-new top-level read-only command

**Decision**: A new top-level `specflow diff` command. New `DiffProjectUseCase` (`diff_project.ts`)
depends on `FsReader` + `LockStore` + `findHarness` — **no `FsWriter`**. It maps `CORE_BUNDLE` for
the installed templates version (the same call `upgrade_handler.ts` already makes), reads each
lock-tracked file from disk, and returns `DivergenceResult[]` (`differs` | `matches` | `missing`).
The new `diff_handler.ts` renders each `differs` via the existing `renderUnifiedDiff`
(`src/domain/diff.ts`), prints "no divergence" + exit 0 when empty, and never returns non-zero
except on error.

**Rationale**: Divergence auditing is conceptually independent of upgrading (a maintainer runs it
any time), so a top-level verb is more discoverable than an `upgrade` sub-flag. `upgrade --dry-run`
already shows the _plan_, not file-level diffs — `diff` fills a distinct need. Reusing
`renderUnifiedDiff` + `CORE_BUNDLE` means no new rendering or bundle-read port.

**Alternatives considered**: `specflow upgrade --diff` — rejected: conflates auditing with the
upgrade flow and is less discoverable; a post-publish or networked diff — rejected: the embedded
bundle is already local and authoritative.

## D6 — `--reset-preserved` threads through handlers only

**Decision**: Parse `--reset-preserved` in `parser.ts` (boolean) for both `init` and `upgrade`. In
the handlers: when set, `init_handler` passes an empty `preservedPaths` set; `upgrade_handler`
passes `isDeclaredPreserved: () => false`. Each handler logs a per-path warning for every preserve
it overrode (FR-005). The use-cases never read the flag — they see only the resulting
predicate/empty set.

**Rationale**: Keeps the domain/use-case ignorant of CLI intent; the flag is purely a wiring
concern. Symmetry with FR-004's preserve notice: overrides are surfaced per file, never silent.

**Alternatives considered**: a `RefreshMode` enum passed into the domain — modelled as a value
object in data-model.md for clarity, but the predicate form is what the code threads (no need for
the domain to branch on mode).

## D7 — Unknown-path validation at run time, in the handlers

**Decision**: `preserve_config.ts` parses the YAML without judging path validity. The handlers,
after loading the store, compare declared paths against `Object.keys(bundle)` and emit a yellow
`warn:` line per unknown path (FR-008), filtering them out before the use case runs.

**Rationale**: Keeps the domain parser pure and bundle-agnostic; surfaces the warning at the same
moment the user sees refresh output. A typo'd path is ineffective-but-not-fatal, exactly as the spec
requires.

**Alternatives considered**: validating in the parser — rejected: would force the bundle into the
pure domain layer.

## D8 — Parent-managed and plugin-coverage interactions

**Decision**: No special case needed for parent-managed (009). Agentic paths are filtered out of the
bundle by `isAgenticPath` BEFORE the preserve check, so a declared agentic path in a parent-managed
sub-repo is simply never in `bundleToWrite` — the preserve predicate is never consulted for it. For
plugin-coverage, ordering the declared-preserve check first (D4) ensures a declared file is never
migrated to the plugin.

**Rationale**: Both interactions resolve by ordering alone; introducing flags or special cases would
add surface for no behavioural gain.

## Open risks

- **`--reset-preserved` flag scoping** — `stdParseArgs` boolean registration is global; registering
  `--reset-preserved` once covers both `init` and `upgrade`. Confirm the flag is only _acted on_ in
  the two relevant handlers (a stray `--reset-preserved` on an unrelated command is inert).
- **Manifest path normalisation** — declared paths must match the bundle's destination-path form
  exactly (project-relative, forward-slash). The handler comparison and any preserve-set membership
  test must normalise consistently; cover with a unit test (leading `./`, backslashes on Windows).
- **`diff` over a removed-upstream path** — a declared path no longer in the new bundle yields a
  `missing` divergence result (FR-009); ensure the handler renders it as "kept on disk, dropped from
  bundle" rather than crashing on an absent bundle entry.
- **Empty/garbage `preserve.yml`** — must degrade to `EMPTY_PRESERVE_CONFIG` (treat unparseable as
  empty + a warn), never abort init/upgrade.
