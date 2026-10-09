**`specnaut-guide` now runs on Claude Haiku 5.5, and the agent fleet has a written rule for choosing
a model.** The guide reads Specnaut's docs and explains them, and you read its whole answer, so it
no longer needs Opus pricing. Its upgrade walk now shows each fetched release and the files it is
about to commit before it acts. Every other bundled agent stays on Opus. Review lenses,
orchestrators, the backlog owner and the builders fail silently when they miss something, and the
agents README explains why seat by seat. The same rule applies when a skill dispatches a subagent:
Haiku for a mechanical task you will check, never for a reviewer. On Codex the guide maps to
`gpt-5.6-luna`, and on Antigravity to `flash`.
