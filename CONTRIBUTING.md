# Contributing to Specnaut

## Agent adoption {#agent-adoption}

Every PR titled `feat: …` (or `feat(scope): …`) MUST include an `## Agent adoption` section in its
body. The section is the contract between the PR author and the release pipeline:

1. `scripts/gen-changelog.ts` extracts the section at release time.
2. It lands in the GitHub Release body under `### Adoption guide`.
3. After `specnaut upgrade`, the `specflow-expert` agent reads the release body and plays each
   adoption prompt one at a time in the user's project.

### Format

````markdown
## Agent adoption

<one-paragraph prose explaining what existing projects need to do>

```prompt
<one ready-to-paste prompt for an AI agent>
```
````

- Use the language `` ```prompt `` for the fenced code block — this is how the release pipeline
  finds it.
- Prose first, prompt second. Keep prose under 100 words.
- Address an AI agent in the prompt, not a human. Prefer concrete file paths and literal command
  names.

### Example: a deprecation

````markdown
## Agent adoption

`/specflow specify "<feature>"` now chains every phase through to `review` in a single session. If
your project has agent rules or documentation pointing users at `/specflow-auto`, update them to
`/specflow specify`. `--manual` is the per-phase opt-out.

```prompt
Audit my project for any reference to `/specflow-auto` in:
  - `.claude/agents/*.md`
  - `.cursor/rules/*.mdc`
  - `AGENTS.md`, `CLAUDE.md`

Replace each with `/specflow specify "<…>"`. Add a brief note explaining
`--manual` is the per-phase opt-out. Open a PR with the changes.
```
````

### Example: a new command

````markdown
## Agent adoption

`specnaut reconcile` is a new subcommand for per-file post-upgrade reconciliation. Projects with
`.claude/agents/` or harness rules that document the upgrade flow should mention it.

```prompt
Add a short note to my project's `.claude/agents/specflow-expert.md` (and any
equivalent agent files for other harnesses) that `specnaut reconcile --status`
lists pending post-upgrade reconciliation. Open a PR.
```
````

### When the section is optional

`fix:`, `chore:`, `refactor:`, `docs:`, `test:`, and `ci:` PRs may omit the section. If a `fix:`
changes user-visible behavior (rare), the section is recommended — `gen-changelog.ts` will surface
it.

### CI enforcement

`.github/workflows/pr_adoption_lint.yml` runs on every `pull_request` event. It fails on `feat:` PRs
that lack `## Agent adoption` followed by a `` ```prompt `` block. The failure message points back
to this section.
