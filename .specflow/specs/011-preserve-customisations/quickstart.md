# Quickstart — Preserve per-project customisations

Manual reproduction of the bug and the fix, plus the automated-coverage map. Issue #367.

## Manual repro — the regression (before the fix)

```bash
# In a Specflow-initialised project:
$ printf '\n# my project-specific PO config\n' >> .claude/agents/product-owner.md   # customise
$ specflow init --here --force                                                       # forced refresh
# ⇒ .claude/agents/product-owner.md silently reverted to the generic bundled version.
```

## Manual repro — the fix (after this feature)

```bash
# 1. Declare the file preserved:
$ cat .specflow/preserve.yml
preserved:
  - .claude/agents/product-owner.md

# 2. A forced refresh now keeps it, and says so:
$ specflow init --here --force
…
preserved .claude/agents/product-owner.md — declared in .specflow/preserve.yml
…
# ⇒ the customised file is byte-identical to before the refresh.

# 3. upgrade honours the same declaration:
$ specflow upgrade
…
preserved .claude/agents/product-owner.md — declared in .specflow/preserve.yml

# 4. See how the preserved file has drifted from the evolving bundle (read-only):
$ specflow diff
--- bundled .claude/agents/product-owner.md
+++ on-disk .claude/agents/product-owner.md
@@ …
+# my project-specific PO config
# ⇒ mutates nothing; exit 0.

# 5. Deliberately discard the customisation for a clean bundle (explicit opt-out):
$ specflow init --here --force --reset-preserved
…
override .claude/agents/product-owner.md — --reset-preserved overrode the declaration
# ⇒ file restored to the bundled version. Never happens without the flag.
```

## Edge-case probes

```bash
# Declared path that isn't a managed file ⇒ ineffective, warned, not fatal:
$ printf 'preserved:\n  - not/a/bundled/file.md\n' > .specflow/preserve.yml
$ specflow init --here --force
warn: not/a/bundled/file.md — declared preserved but not a managed file (ignored)

# Declared path dropped upstream ⇒ kept on disk, surfaced:
$ specflow diff
missing  .claude/agents/old-agent.md — on disk, no longer in the bundle (kept)

# No preserve.yml ⇒ today's behaviour, byte-for-byte (FR-011).
```

## Automated coverage map

| Spec item                                         | Test                                             | Kind           |
| ------------------------------------------------- | ------------------------------------------------ | -------------- |
| Manifest parse/serialize/normalise/degrade        | `tests/domain/preserve_config_test.ts`           | unit (pure)    |
| Store read/write/absent                           | `tests/infrastructure/fs_preserve_store_test.ts` | unit (fake fs) |
| upgrade emits `preserve/"declared"`, ordering     | `tests/domain/upgrade_plan_test.ts`              | unit (pure)    |
| init filters write set; no-preserve unchanged     | `tests/application/init_project_test.ts`         | unit (fakes)   |
| diff read-only: differs/matches/missing           | `tests/application/diff_project_test.ts`         | unit (fakes)   |
| end-to-end force-keep + reset-overwrite + notices | `tests/integration/init_preserve_test.ts`        | integration    |

All tests are hermetic — injected `FsReader` / `FsWriter` / `LockStore` / `PreserveStore` fakes, the
in-repo `CORE_BUNDLE`, and a temp project dir for the integration test. No network, no real binary,
no live `gh`.

## Done when

- `specflow init --force` leaves a declared file byte-identical (SC-001) with a per-file notice
  (SC-002).
- `specflow diff` shows divergence read-only (SC-003).
- A no-preserve project is unchanged (SC-004); `--reset-preserved` overwrites only when passed
  (SC-005); the `product-owner.md` regression is closed (SC-006).
- `deno task test` green; `deno fmt --check` + `deno lint` clean.
