# Bundled agents — naming, model and effort

Each is assigned by role class, so adding an agent is a lookup rather than a judgement call.

## Naming — the suffix carries meaning

| Suffix | Meaning | Agents |
| ------ | ------- | ------ |
| `<domain>-expert` | A review lens that **also** has a `/task audit` axis — dual mode: per-diff review *and* scoped audit | `accessibility-expert`, `architect-expert`, `dependency-expert`, `performance-expert`, `security-expert` |
| `<domain>-reviewer` | A review lens with **no** audit axis — it only ever sees a diff | `code-reviewer` |
| role noun | Does the work rather than judging it | `developer`, `product-owner` |

- **`-expert` ⇔ an audit axis exists.** The five `-expert` agents are exactly the five axis flags of
  `/task audit` (`--security`, `--perf`, `--a11y`, `--archi`, `--deps`). Give `code-reviewer` an
  audit axis and **rename it to `-expert` in the same change**.
- **Agents spell the domain out; flags may abbreviate.** A flag is typed by a human, where short
  wins; an agent name is matched by a model against a request, where `accessibility` is a far
  stronger signal than `a11y`.

`specnaut-guide` is the one exception: named after the tool, it answers questions about Specnaut and
is **not** an `-expert` — there is no audit axis for Specnaut itself.

## Model — who checks the output?

**Opus is the default; eight of the nine seats keep it.** `haiku` is right only when **the person
who asked reads the whole output and is the check on it, and no downstream gate treats that output
as complete** — never for a seat whose "nothing found" is trusted as "nothing there". The test is
whether a miss is visible, not how capable the model is, so a stronger `haiku` never widens the
list on its own.

| Model | Agents | Why |
| ----- | ------ | --- |
| `haiku` | `specnaut-guide` | Reads docs and explains; the user reads the whole answer. Its upgrade walk shows each fetched release and the files it commits before acting, and hands adoption and merges to `developer`. |
| `opus` | `code-reviewer`, `accessibility-expert`, `performance-expert`, `dependency-expert`, `security-expert`, `architect-expert` | Review lenses — nobody re-reads what they cleared. |
| `opus` | `product-owner` | Grooming is judgement; its mechanical board moves share the seat. |
| `opus` | `developer` | The builder — review samples its work, it does not re-derive it. |

The same test applies per dispatch: a skill may pass `model: "haiku"` for a mechanical subtask the
caller will check, never for a review lens.

## Effort — the reasoning budget

| Tier | Role class | Agents |
| ---- | ---------- | ------ |
| `high` | Everything else — agentic work, review lenses, the backlog owner, the explainer | `developer`, `accessibility-expert`, `dependency-expert`, `performance-expert`, `code-reviewer`, `product-owner`, `specnaut-guide` |
| `xhigh` | The two lenses whose misses are unrecoverable | `architect-expert`, `security-expert` |

Tally: 7 `high` · 2 `xhigh` = 9 agents. `low` and `medium` remain valid for a project's own agents;
**no bundled agent uses them.** Effort is independent of the model tier.

**`high` is the floor** because an under-provisioned lens fails quietly: a well-formatted report
with fewer findings is indistinguishable from clean code. **`xhigh` marks an unrecoverable miss, not
hard work**: `developer`'s shallow pass meets tests, review and a human; nothing checks
`security-expert` or `architect-expert`, whose misses ship or become load-bearing. `architect-expert`
is `disable-model-invocation: true`, which bounds what its tier costs; `security-expert` is not, and
is bounded instead by the phases that dispatch it — every review diff and every plan.

## How the two axes reach other harnesses

`model:` names a family, never a version — **Specnaut names no model version anywhere**. The
families correspond across harnesses, Fable → Astra included:

| Claude Code | Codex |
| ----------- | ----- |
| Haiku | Luna |
| Sonnet | Terra |
| Opus | Sol |
| Fable | Astra |

Codex accepts only versioned ids, so a Codex agent file carries no `model` key and runs on the
session's model, with a comment naming the family (`src/domain/codex_models.ts`):

| Specnaut | Codex |
| -------- | ----- |
| `model: fable` / `opus` / `sonnet` / `haiku` | `# Model family: Astra` / `Sol` / `Terra` / `Luna` (comment) |
| `effort: low` / `medium` / `high` / `xhigh` | `model_reasoning_effort`, verbatim |

`ultra` and `max` are never emitted; an unrecognised value omits the key rather than guessing.
**Antigravity** maps both capable tiers to `pro` and `haiku` to `flash`, and drops `effort:`
(`src/domain/antigravity_models.ts`). **OpenCode** omits both axes — its `model` is a
provider/model pair, the user's choice. **Cursor and Copilot** have no subagents: agents reach them
as skills and instruction files, and neither axis applies.

## Adding an agent

Pick the suffix from the naming table, the model by who checks the output (default `opus`), and the
effort tier (default `high`; `xhigh` only when nothing downstream would catch the agent thinking too
little).
