# Auto-generate a task's spec at creation (cloud, opt-in)

Loaded from the task skill when this project has `spec_autogen: true` in
`.specnaut/installed.lock` **and** stores its specs on SpecNaut Cloud. When either is
false the skill does not point here and task creation is unchanged.

Immediately **after** creating a task, ALSO generate its spec: run the cloud `plan` flow for
the new task (branch-free — no git branch, no local `.specnaut/specs/` files), so the spec is
already written when the task is later picked for implementation. No waiting, no blocking
pre-step.

- Trigger it once per newly created task, right after the create succeeds — for a single
  `add.sh` or for every task in a batch.
- **Never fatal to task creation** — if spec generation fails (offline, auth, model error),
  report it and continue; the task stays created and the spec-gen is retryable later by
  running the cloud `plan` for that task by hand.
- **Prepare many at once** — because cloud `plan` is branch-free, plans for several freshly
  created tasks can be generated concurrently with no git-branch collision.
