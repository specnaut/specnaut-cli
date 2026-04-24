# CloudCode Skill Notes

This skill follows the CloudCode guidance for keeping `SKILL.md` short and
placing detailed material in support files.

## Structure

- `SKILL.md` Short entrypoint with discovery keywords, workflow, and links to
  support files.
- `references/` Detailed documentation that should only be loaded when needed.
- `scripts/` Executable helpers that Claude can run instead of embedding shell
  logic or secrets in the prompt.

## Why Scripts Matter

- Secrets stay in the sibling `.env` file.
- The LLM does not need to reconstruct auth headers or endpoint details from
  scratch.
- Repeated ConfigCat inspection becomes deterministic and reusable.

## CloudCode Patterns Applied Here

- Keep `SKILL.md` focused and under the recommended size.
- Reference support files explicitly so the assistant knows when to load them.
- Put imperative operational behavior in `scripts/`.
- Keep credentials outside the prompt and outside committed docs.

## Helpful Variable

- `${CLAUDE_SKILL_DIR}` points to the skill directory when CloudCode expands
  skill content, so scripts can be invoked without relying on the working
  directory.
