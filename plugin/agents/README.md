# Bundled agents — naming and effort

Two conventions govern this directory: what an agent is **called**, and how
much reasoning budget it is **given**. Both are assigned by role class, so
that adding an agent is a lookup rather than a judgement call.

## Naming — the suffix carries meaning

An agent's suffix is not decoration. It tells you how the agent is reached
and what it is allowed to do, and the fleet is meant to stay legible when
someone reads a dispatch line without opening the agent file.

| Suffix | Meaning | Agents |
| ------ | ------- | ------ |
| `<domain>-expert` | A review lens that **also** has a standalone `/specnaut audit <domain>` phase — dual mode: per-diff review *and* whole-codebase audit | `accessibility-expert`, `architect-expert`, `dependency-expert`, `performance-expert`, `security-expert` |
| `<domain>-reviewer` | A review lens with **no** audit phase — it only ever sees a diff | `code-reviewer`, `test-reviewer` |
| `-coordinator` | Fans out the lenses of a **single** phase and aggregates what returns | `review-coordinator` |
| `-manager` | Drives a **multi-phase** delivery across several agents | `workflow-manager` |
| role noun | Does the work rather than judging it | `developer`, `qa-tester`, `devops-sre`, `product-owner`, `ui-ux-designer` |

Two rules follow, and they are the whole point of writing this down:

- **`-expert` ⇔ an audit phase exists.** The five `-expert` agents correspond
  exactly to the five `audit-*.md` phases. If you give `code-reviewer` or
  `test-reviewer` an audit phase, **rename it to `-expert` in the same
  change** — otherwise the suffix stops predicting anything and the next
  person picks one at random.
- **Agents spell the domain out; skills may abbreviate.** The agent is
  `accessibility-expert` while its skill is `a11y-audit`, and that asymmetry
  is deliberate: a skill name is *typed by a human* at a prompt, where short
  wins, whereas an agent name is *matched semantically by a model* against a
  request, where `a11y` is a far weaker signal than `accessibility`. Optimise
  each for its own reader.

`specnaut-guide` is the deliberate exception to the table — the only agent
named after the tool itself. It answers questions about Specnaut rather than
reviewing your code, so it carries neither a lens suffix nor a role noun. It
is **not** an `-expert`: giving it that suffix would imply an
`/specnaut audit specnaut` phase that does not and should not exist.

## Model and effort — two budgets

Every bundled agent declares `model:` and `effort:` in its frontmatter.
`model` picks the capability tier; `effort` is a reasoning-budget hint the
harness reads on dispatch: a higher tier thinks harder and costs more.

### Model — who checks the output?

**Opus is the default, and fourteen of the fifteen seats keep it.** A fleet
that mixes tiers mostly produces a fleet where the cheap agents are the ones
that miss things — the failure is silent, arrives as a clean report, and costs
more to discover later than the tokens it saved.

`haiku` is right for a seat when **the person who asked reads its whole output
and is the check on it, and no downstream gate treats that output as
complete.** It is wrong for any seat whose "nothing found" is trusted as
"nothing there", and for any seat whose work is only sampled afterwards.

The rule is about **whether a miss is visible**, not about how capable the
model is. A stronger `haiku` makes a miss rarer, not easier to see, so a new
release never widens the list on its own — re-run the test on the seat.

| Model | Agents | Why |
| ----- | ------ | --- |
| `haiku` | `specnaut-guide` | Reads docs and explains; the user reads the whole answer. Its upgrade walk shows each fetched release and the files it commits before acting, and hands adoption and merges to `developer`. |
| `opus` | `code-reviewer`, `test-reviewer`, `accessibility-expert`, `performance-expert`, `dependency-expert`, `security-expert`, `architect-expert` | Review lenses — nobody re-reads what they cleared. |
| `opus` | `review-coordinator`, `workflow-manager` | Orchestrators — a dropped finding or a skipped step leaves no trace downstream. |
| `opus` | `product-owner` | Grooming is judgement; its mechanical board moves share the seat. |
| `opus` | `developer`, `devops-sre`, `ui-ux-designer`, `qa-tester` | Builders and the QA gate — review samples their work, it does not re-derive it. |

The same test applies per dispatch: a skill may pass `model: "haiku"` for a
mechanical subtask the caller will check, never for a review lens.

### Effort — the reasoning budget

| Tier | Role class | Agents |
| ---- | ---------- | ------ |
| `high` | Everything else — agentic work, review lenses, orchestrators, the backlog owner, the design agent, the explainer | `developer`, `qa-tester`, `devops-sre`, `accessibility-expert`, `dependency-expert`, `performance-expert`, `code-reviewer`, `test-reviewer`, `review-coordinator`, `workflow-manager`, `product-owner`, `ui-ux-designer`, `specnaut-guide` |
| `xhigh` | The two lenses whose misses are unrecoverable | `architect-expert`, `security-expert` |

Tally: 13 `high` · 2 `xhigh` = 15 agents. `low` and `medium` remain valid
values for a project's own agents; **no bundled agent uses them.**

Effort is independent of the model tier: a `haiku` seat takes the same
`effort:` scale, and `specnaut-guide` keeps `high` — its upgrade walk is a
multi-step procedure, and the tier change already pays for the saving.

### Why `high` is the floor

The earlier rubric put review lenses at `medium` and orchestrators at `low`,
reasoning that a dispatcher does not think and a read-only pass needs less
depth than writing code. Both halves turned out to be wrong in the same way.

- **A review lens under-provisioned fails quietly.** It returns a
  well-formatted report with fewer findings, which is indistinguishable from
  clean code. There is no error, no retry, and nothing downstream notices —
  the saving is visible and the cost is not.
- **An orchestrator does reason.** `review-coordinator` decides *which*
  lenses to fire against a given diff and reconciles findings that several
  of them report differently; `workflow-manager` sequences a delivery and
  judges when a phase is actually done. Neither is a switch statement.

The compound-cost worry behind the old `low` tier is real — a coordinator
pays its own budget plus every child's — but it is an argument for fanning
out fewer lenses, not for the one agent choosing them thinking less.

### Why only `architect-expert` and `security-expert` go further

The tier is not a ranking of importance, and it is not "who does the hardest
work" — by that measure `developer` would top the list. It asks one question:
**when this agent thinks too little, what catches it?**

For `developer`, `qa-tester`, and `devops-sre`, something does. A shallow
coding pass meets a test suite, a review gate, and a human reading the diff.
The work is verified downstream by construction, so extra budget buys a better
first draft of something that was going to be checked anyway.

Nothing checks the checker. When `security-expert` thinks too little it
returns a clean report, and a clean report is indistinguishable from clean
code — the miss ships, and it is discovered by whoever finds the
vulnerability first. When `architect-expert` misses a layering violation, the
violation is load-bearing by the time anyone notices. These two also need to
hold a whole-system model in mind rather than pattern-match a diff, which is
what the extra budget actually buys.

So `xhigh` marks *unrecoverable misses*, not *hard work*. Both seats are
`disable-model-invocation: true` and fire only from a review or audit phase,
which also bounds what the tier costs.

### How the two axes reach other harnesses

`model:` and `effort:` are Claude's vocabulary, but they describe two axes
every harness has. On Codex they translate onto its own two, in
`src/domain/codex_models.ts`:

| Specnaut | Codex |
| -------- | ----- |
| `model: opus` | `model = "gpt-5.6-sol"` |
| `model: sonnet` | `model = "gpt-5.6-terra"` |
| `model: haiku` | `model = "gpt-5.6-luna"` |
| `effort: low` / `medium` / `high` / `xhigh` | `model_reasoning_effort`, verbatim |

Specnaut's effort vocabulary is a strict subset of Codex's
(`ultra`, `max`, `xhigh`, `high`, `medium`, `low`), so that half is identity.
`ultra` and `max` are never emitted — a subagent is already the unit `ultra`
fans out over.

An unrecognised value on either axis omits that key rather than guessing, so
the subagent inherits the parent session's setting. A wrong pin fails on the
user's machine, against a model list we cannot see; inheriting cannot.

**When OpenAI renames a model, `src/domain/codex_models.ts` is the only file
to edit.** The ids live there for that reason, and a fleet-level test asserts
every emitted id is one of the three.

On **Antigravity** the vocabulary is `inherit | flash | pro`, so the two
capable tiers collapse onto `pro` and `haiku` maps to `flash`
(`src/domain/antigravity_models.ts`). Antigravity has no reasoning-effort
knob, so `effort:` is dropped there rather than approximated.

On **OpenCode** both axes are deliberately omitted. Its `model` field takes a
`provider/model-id` pair, and OpenCode is provider-agnostic — emitting
`anthropic/…` would pin every agent to one vendor's account, which is the
user's choice and not Specnaut's. Reasoning options pass straight through to
the provider there, so a value valid for one errors on another. Omitting both
means each agent runs on whatever the user configured: the correct answer,
not a missing feature.

**Cursor, Windsurf, and Copilot have no subagent concept at all.** Agents
reach them as skills, workflows, and instruction files respectively — the
content survives, the dispatch boundary does not. Neither axis applies.

### Adding an agent

Pick the suffix from the naming table, then the tier from the effort table.
Default to `high`. Reach for `xhigh` only when the agent's output is the last
line of defence — when nothing downstream would catch it thinking too little.
Doing hard work is not the test; being unchecked is. Then pick the model
with the question above — who checks the output? — and default to `opus`.
