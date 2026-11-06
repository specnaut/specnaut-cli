# Auto-generate a task's spec at creation (cloud, opt-in)

Loaded from the task skill when this project has `spec_autogen: true` in
`.specnaut/installed.lock` **and** stores its specs on SpecNaut Cloud. When either is
false the skill does not point here and task creation is unchanged.

Immediately **after** creating a task, ALSO generate its spec: run the cloud `plan` flow for
the new task (branch-free — no git branch, no local `.specnaut/specs/` files), so the spec is
already written when the task is later picked for implementation. No waiting, no blocking
pre-step. The flow ends with its push, at the plan stop or step 8, and invokes nothing after it.

- Trigger it once per newly created task, right after the create succeeds — one per
  `APPLIED create <n>` line the executor printed (`backlog.md`, "The session protocol").
- **Never fatal to task creation** — if spec generation fails (offline, auth, model error),
  report it and continue; the task stays created and the spec-gen is retryable later by
  running the cloud `plan` for that task by hand.
- **Prepare many at once** — because cloud `plan` is branch-free, plans for several freshly
  created tasks can be generated concurrently with no git-branch collision.
