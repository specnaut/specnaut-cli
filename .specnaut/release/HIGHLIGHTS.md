**One unit of work, one address: `/task`.** The backlog (`list`, `next`, `add`, `edit`, `close`,
`groom`), the delivery pipeline (`plan` → `tasks` → `implement` → `review` → `merge`), audits
(`/task audit --security|--archi|--perf|--a11y|--deps`, every applicable axis with no flag) and
`constitution` now live under one skill. `/specnaut` documents the framework (`doc`, `list`,
`upgrade`), `/ship` is unchanged. `/board`, `/code-audit` and the five `*-audit` skills are retired,
with no aliases: `/specnaut plan` names its new address and stops. `specnaut upgrade` carries your
edited phase documents and your addenda to their new address, and never overwrites or follows a link
to do it. Skill descriptions loaded in every session shrink by about a third on Claude Code and
almost half on Codex.

**Rules that must hold are hooks, on Claude Code and Codex.** Under `merge: manual`, a merge into
the base branch really waits for your go-ahead; a Specnaut agent runs on the model its definition
declares; `installed.lock` cannot be hand-edited; on Codex, publishing a release needs your go-ahead
in the same turn. On Codex, trust the hooks once with `/hooks` after upgrading.

See [UPGRADING.md](https://github.com/specnaut/specnaut-cli/blob/main/UPGRADING.md) for what moved.
