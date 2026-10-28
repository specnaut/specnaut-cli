**One instruction file for Claude Code and Codex.** `.claude/CLAUDE.md` and `.codex/AGENTS.md` are
now links to the project's root `AGENTS.md`, so both harnesses load the same rules. Where the system
refuses links, each is a one-line pointer instead, and `init` and `upgrade` say which form they
wrote. If you edited `.claude/CLAUDE.md`, `upgrade` backs your copy up and replaces it: move what
you still need into `AGENTS.md` (see
[UPGRADING.md](https://github.com/specnaut/specnaut-cli/blob/main/UPGRADING.md)).

**Codex starts Specnaut's agents by name.** `.codex/config.toml` now enables agents, and `AGENTS.md`
names the agent for each delegated step of the chain. `.codex/goal.md`, which Codex never read, is
retired.

**Specnaut no longer writes or reads outside the project through a planted link.** The containment
check now follows a link's text the way the operating system does, segment by segment. It refuses a
link that passes through a directory that does not exist yet. Before, a link chain in a cloned
repository could make `init`, `upgrade` or `diff` touch a file outside the project.

**`/ship tag` refuses a dirty working tree** and lists what is uncommitted, instead of tagging a
HEAD that does not match the files beside it.
