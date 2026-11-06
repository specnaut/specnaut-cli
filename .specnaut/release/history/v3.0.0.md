**Two agents are renamed.** `a11y-expert` → `accessibility-expert`, and `specnaut-expert` →
`specnaut-guide`. There are no aliases: a stale reference fails at dispatch time, not at scaffold
time, so it stays silent until the moment you need the seat. The adoption prompt below finds them
for you.

**`/specnaut merge` no longer opens a pull request.** It never actually did — the mandate lived in
project governance, not in the phase — and now the phase says so. The default is a local
fast-forward onto the base branch; `--pr` is the opt-in for a protected branch, a required human
review, or CI that only triggers on `pull_request`.

**Codex agents pick a model.** Each seat's capability tier now selects a GPT-5.6 model — Sol, Terra,
or Luna — and its `effort:` reaches `model_reasoning_effort` verbatim instead of being guessed from
the model name. Every bundled agent runs on Opus, at `high`, with `xhigh` reserved for
`architect-expert` and `security-expert`: the two seats whose misses nothing downstream would catch.

**Antigravity projects were a dead end.** `init --ai antigravity` wrote a lock that `upgrade` then
refused to read, and the whole tree was scaffolded into `.agent/` when Antigravity reads `.agents/`.
Both fixed. If you have an existing Antigravity project, the adoption prompt below cleans up the old
tree.
