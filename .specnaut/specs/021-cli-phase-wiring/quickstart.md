# Quickstart — phase wiring, locally

Against the working-tree CLI (`deno run --allow-all src/main.ts …`).

## 1. Local mode — nothing changes
```bash
deno run --allow-all src/main.ts init --here --ai claude --spec-backend local
# The rendered implement.md / review.md / analyze.md / tasks.md are byte-identical to
# pre-feature — no `spec pull`, no auto-gen. [SC-002]
```

## 2. Cloud mode — pull-on-entry
```bash
deno run --allow-all src/main.ts init --here --ai claude --spec-backend cloud
# The rendered implement.md (and review/analyze/tasks) now open with a single
# `specnaut spec pull <task>` step; agents then read the materialised cache files. [SC-001]
```

## 3. Auto-generation toggle
```bash
# enable in the lock:
#   spec_autogen: true
# Now the task-creation guidance instructs: create task → also run cloud specify for it,
# branch-free; a gen failure is reported but the task stays created. [SC-003, SC-004]
# Default (absent/false): task creation is unchanged.
```

## 4. Parallel authoring
```bash
# In cloud mode, author specs for 3 tasks at once — each cloud specify is branch-free,
# so no collision; each pushes to its own task. [SC-005]
```

## 5. Boundary
```bash
# grep the touched phase docs: the only Cloud touch is `specnaut spec pull` / cloud specify —
# no private-half identifier. [SC-006, § I]
```

## Automated coverage
`deno task test` — golden local-parity tests on implement/review/analyze/tasks (EOL-agnostic);
`installed_lock` round-trip of `spec_autogen` (absent→false); integration: cloud-mode rendered
docs contain the pull step, local docs don't.
