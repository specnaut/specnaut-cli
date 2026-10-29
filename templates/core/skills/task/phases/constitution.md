
Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before constitution update)**:
- Check if `.specnaut/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_constitution` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
- If no hooks are registered or `.specnaut/extensions.yml` does not exist, skip silently

## Outline

The project's constitution is `docs/constitution.md`. It is the team's document, not Specnaut's:
Specnaut bootstrapped it once and only reads it since. An amendment is exceptional, happens only
because the user asked for it, and is written only after the user has seen it and typed the
confirmation phrase below. A hook enforces that last part: without the phrase, every write to the
file is refused, whatever tool attempts it, and a change made some other way is caught when the turn
ends. Never look for another route; ask.

The same verb changes the three **gate configs**, which hold the settings the project's gates read:
`.specnaut/size-limits.yml`, `.specnaut/boundaries.yml` and `.specnaut/ui.yml`. They are not the
constitution, so they take no version bump, but they are gated the same way under their own phrase.

| What changes | The user types, as their whole message | Kind |
| --- | --- | --- |
| `docs/constitution.md` | `approve the constitution amendment` | `constitution` |
| a gate config | `approve the gate config change` | `gate-config` |

One approval covers one kind for one turn. A request that changes both is two rounds: the
constitution first, then the configs. A plain "yes", "ok" or "go" approves nothing.

### Round 1: draft, then stop

1. **The reason.** If the request does not say why the change is needed, ask, in one question.
   Nothing is drafted without a reason the user gave: it goes into the commit body.
2. **Read** the current file. If `docs/constitution.md` is missing, say so and stop: `specnaut
   upgrade` bootstraps it. Never recreate it from memory.
3. **Draft** the smallest change that serves the reason:
   - Keep each principle declarative and checkable: a short rule, and a `Check:` line a reviewer
     can apply to a plan or a diff.
   - Keep the constitution to principles. Delivery status, task and epic narratives, and dated
     incident history do not belong in it: link the issue or spec that holds them instead. The file
     is read by every planning and review step, and the size limits hold it to its own
     `constitution` unit.
   - No HTML comments, no change log, no report inside the file: git history is the record.
   - No import: a line holding `@` followed by a path is refused, whoever asks. Claude Code loads
     the file into every session and would follow the import, unguarded, into every one.
4. **Bump `Version:`** (the footer line) for a constitution change, by semantic versioning:
   - MAJOR: a principle removed, or redefined so that existing code may now violate it.
   - MINOR: a principle added, or materially expanded.
   - PATCH: wording, clarification, a typo.

   Shrinking the file never licenses dropping a principle: a removal still takes the MAJOR bump.
   A gate config change has no version.
5. **Show** the user the diff, the bump with its one-line rationale, and the commit message you will
   use. Then print the phrase for that kind, exactly as in the table, and end the turn:

   ```text
   To apply this, reply with exactly: approve the constitution amendment
   ```

   Do not write the file in this turn. Any reply other than the phrase is feedback: revise the draft,
   show it again, print the phrase again.

### Round 2: the user typed the phrase

6. **Write** the drafted change, exactly as shown, to the file it names. Nothing else is touched.
7. **Commit** it alone. The subject names the change; the body carries the reason, in the user's
   words, and for the constitution the version change:

   ```text
   docs(constitution): <what changed>

   Reason: <the reason the user gave>
   Version: 1.2.0 → 1.3.0
   ```

8. **Report** the new version (or the config written) and the commit, in two lines.

If a principle now conflicts with the code, or with another principle, report it as a stop with a
question. Never resolve it by amending the constitution on your own initiative.

## Post-Execution Checks

**Check for extension hooks (after constitution update)**:
Check if `.specnaut/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.after_constitution` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    ```
- If no hooks are registered or `.specnaut/extensions.yml` does not exist, skip silently
