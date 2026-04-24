---
name: claude-configurator
description: Automatically scaffolds the .claude/ folder and CLAUDE.md for Claude Code based on best practices. Use when configuring Claude Code for a project.
---

# Claude Code Configurator Skill

This skill is designed to bootstrap a complete, best-practice `.claude/` directory structure and `CLAUDE.md` for Claude Code in the current project, as outlined in the "Anatomy of the .claude/ folder" guide.

## 🚨 Execution Steps for the AI

When the user asks to configure Claude Code or generate the `.claude` folder, you must autonomously create the following files and directories using your file creation tools (`write_to_file`). Be sure to replace structural placeholders like `[Project Name]` with the actual project details (e.g., Miximodel context).

### Step 1: Root `CLAUDE.md` (The Instruction Manual)

Create `CLAUDE.md` in the root of the workspace.
**Rules for this file:**

- Keep it under 200 lines (longer files drop instruction adherence).
- DO write: Build/test commands, architectural decisions, conventions, and non-obvious gotchas.
- DO NOT write: Formatting rules that belong in a linter, full documentation, or long theory.

**Template to generate:**

```markdown
# Miximodel

## Commands

npm run dev # Start dev server
npm run test # Run tests
npm run lint # ESLint + Prettier check
npm run typecheck # Run TypeScript checks
npm run format # Prettier formatting
npm run build # Production build

## Architecture

- AdonisJS v7 Backend + Inertia.js + React Frontend
- PostgreSQL via Lucid ORM
- Tailwind CSS v4 + ShadCN UI (uses Base UI primitives, not Radix)
- MVC pattern where controllers delegate to services. Form data validated exclusively via VineJS.

## Conventions

- Use `node ace` for framework commands.
- Never use Redux or Client-Side Validation libraries (Zod/Yup).
- State: Zustand is strictly for client UI state (like modals/drafts), never duplicate server state.
- Components must be strictly separated into Dumb (UI only) and Smart (Pages handling Inertia data).
- Always follow the feature-driven architecture folder structure (`inertia/features/<domain>/`).

## Watch out for

- Strict TypeScript: No `any` types.
- Git Hooks: Never bypass pre-commit or pre-push hooks. Keep tests and formatting green.
- `useForm` from Inertia must be used for submissions.
```

### Step 2: Permissions Configuration (`.claude/settings.json`)

Create `.claude/settings.json`. This controls what Claude is allowed to execute without asking.

**Template to generate:**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(node ace *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": ["Bash(rm -rf *)", "Bash(curl *)", "Read(./.env)", "Read(./.env.*)"]
  }
}
```

### Step 3: Modular Path-Scoped Rules (`.claude/rules/`)

Create `.claude/rules/frontend-components.md` to demonstrate modular rules scoped by paths.

**Template to generate:**

```markdown
---
paths:
  - 'inertia/components/**/*.tsx'
  - 'inertia/features/**/components/**/*.tsx'
---

# Frontend React Components Rules

- Always prioritize ShadCN UI primitives in `@/components/ui/`.
- Use design token CSS variables (e.g. `bg-primary`, `text-muted-foreground`), never hardcode colors.
- Use responsiveness via container queries (`@container`) for components, instead of viewport media queries.
- Do NOT use `asChild` on the Button component since it uses Base UI. Use the `render` prop instead.
```

### Step 4: Custom Slash Commands (`.claude/commands/`)

Create `.claude/commands/review.md` to add a `/project:review` command.

**Template to generate:**

```markdown
---
description: Review the current branch diff for issues before merging
---

## Changes to Review

!`git diff --name-only main...HEAD`

## Detailed Diff

!`git diff main...HEAD`

Review the above changes for:

1. Code quality and type safety issues
2. Security vulnerabilities
3. Architecture rule violations (e.g., using forbidden libraries)
4. Missing or broken tests

Give specific, actionable feedback per file based on the PR diff.
```

### Step 5: Auto-Invoked Skills (`.claude/skills/`)

Create `.claude/skills/security-review/SKILL.md` (remember to generate the `security-review` folder).
Skills watch the conversation and trigger autonomously when the task matches the description.

**Template to generate:**

```markdown
---
name: security-review
description: Comprehensive security audit. Use when reviewing code for vulnerabilities, before deployments, or when the user mentions security.
allowed-tools: Read, Grep, Glob
---

Analyze the codebase for security vulnerabilities:

1. SQL injection and XSS risks
2. Exposed credentials or secrets
3. Insecure configurations
4. Authentication and authorization gaps

Report findings with severity ratings and specific remediation steps.
```

### Step 6: Specialized Subagent Personas (`.claude/agents/`)

Create `.claude/agents/code-reviewer.md`.
Agents act as isolated contexts spawned to do focused work quietly before reporting back.

**Template to generate:**

```markdown
---
name: code-reviewer
description: Expert code reviewer. Use PROACTIVELY when reviewing PRs, checking for bugs, or validating implementations before merging.
model: sonnet
tools: Read, Grep, Glob
---

You are a senior code reviewer with a focus on correctness and maintainability in AdonisJS and React.

When reviewing code:

- Flag bugs and architectural violations, not just style issues
- Ensure VineJS is used for validation and ShadCN/Tailwind CSS is used correctly for styling
- Suggest specific fixes, not vague improvements
- Check for edge cases and error handling gaps
```

### Finalization

After executing all the `write_to_file` commands, explain to the user that the `.claude/` folder has been fully configured and acts as a central control system for Claude Code. Mention the availability of local overrides like `CLAUDE.local.md` and `.claude/settings.local.json` should the user wish to personalize their workspace without committing to Git.
