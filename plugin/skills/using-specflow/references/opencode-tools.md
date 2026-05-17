# OpenCode — tool reference

Specflow skills are authored using **Claude Code tool names**. This file
maps each Claude Code tool to its OpenCode equivalent.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `.opencode/plugins/superpowers.js` adapter and inline tool
> mappings. Re-implemented for Specflow.

## Tool mapping

| Claude Code | OpenCode | Notes |
|---|---|---|
| `Read` | `read` | OpenCode's read tool. |
| `Write` | `write` | Same. |
| `Edit` | `edit` | Same. |
| `Bash` | `bash` | Same shape. |
| `Skill` | `skill` | OpenCode exposes a native skill-invocation tool, lowercase. |
| `Task` | `@`-mention subagent | OpenCode uses `@<agent-name>` syntax to dispatch subagents declared by the plugin. |
| `TodoWrite` | `todowrite` | Lowercase variant. |
| `WebSearch` | `websearch` | Lowercase. |
| `WebFetch` | `webfetch` | Lowercase. |
| `Grep` | `grep` | Same. |
| `Glob` | `glob` | Same. |

## Plugin shape — JavaScript adapter

OpenCode plugins ship as JavaScript files (not JSON manifests). The
Specflow adapter (see issue #280) lives at
`.opencode/plugins/specflow.js` and registers itself via OpenCode's
plugin loader:

```javascript
// Pseudo-shape based on superpowers' adapter pattern.
module.exports = function specflow(config) {
  const skillsDir = path.join(__dirname, "../../skills");
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(skillsDir)) {
    config.skills.paths.push(skillsDir);
  }
  // Hook the SessionStart event to inject the using-specflow bootstrap.
  config.experimental = config.experimental || {};
  config.experimental.chat = config.experimental.chat || {};
  config.experimental.chat.messages = config.experimental.chat.messages || {};
  // ...
};
```

Concrete implementation lands in #280.

## Install instructions

Add to the user's `opencode.json`:

```json
{
  "plugin": [
    "specflow@git+https://github.com/mkrlabs/specflow.git"
  ]
}
```

OpenCode fetches the repo, runs the adapter at session start, and the
Specflow skills register themselves.

## Subagent dispatch — concrete pattern

A skill that reads `Use Task to dispatch a code reviewer subagent` should,
on OpenCode, expand to:

```
@code-reviewer Please review the following code change against the plan:
[paste full prompt content]
```

The `@`-mention triggers the subagent declared in the plugin's `agents/`
directory. Wait for the response in the same chat thread.

## Idiom differences worth noting

- **No JSON manifest.** OpenCode's plugin system is code-driven, not
  declarative. The adapter has to perform skill registration imperatively
  in its function body.
- **Skills resolved by path.** OpenCode reads `config.skills.paths` and
  walks each directory for `SKILL.md` files. Specflow's skills live under
  the plugin repo's `skills/` directory and are auto-discovered.
- **Lowercase tool names** throughout. Skill prose that says "use the
  Bash tool" still works because OpenCode's LLM understands the mapping,
  but the actual tool name in JSON tool-use blocks is `bash`.
