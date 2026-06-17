# Lite-chain heuristic

The lite chain (`specify → plan → analyze → implement → review`, skipping
`clarify` and `tasks`) is calibrated for **small, single-file features**:
markdown documentation, agent definitions, README tweaks, AGENTS.md edits,
CLAUDE.md updates, changelog notes. For these, the full chain's spec /
clarify / tasks / analyze / implement / review ceremony produces a
doc/code ratio that's wildly off (concrete prior signal: ~1500 lines of
spec+plan+research+data-model+contracts+quickstart+tasks for ~155 lines
of agent markdown — roughly 10:1).

This file is the **pattern bag** consulted by `phases/specify.md` when
`CHAIN_SHAPE == auto`. Edit the signal lists below to tune detection
without touching `specify.md` logic.

## Scoring

The heuristic runs against the user's feature brief — the text typed
after `/specnaut specify` (after flag-stripping by the router). It
produces a score:

```
score = (signal hits) − (suppressor hits × 2)
```

- **score ≥ 2** → propose the lite chain to the user via the prompt
  below. The user's answer (Y/n) decides.
- **score < 2** → silently keep the full chain.

Suppressors weigh **double** because a single private/system keyword is
strong evidence the work is non-trivial regardless of how the brief is
worded.

## User prompt (when heuristic fires)

```
This brief looks small — run the lite chain?
  Lite chain = specify → plan → analyze → implement → review
               (skips clarify and tasks)
  Full chain = specify → clarify → plan → tasks → analyze → implement → review

Proceed in lite mode? [Y/n]
```

Default to **full** chain on an empty or unclear answer. The prompt
appears exactly **once** per `/specnaut specify` invocation — there is
no re-prompting mid-chain.

## Signal lists

Each match (substring, case-insensitive) contributes **+1** to the
score.

### File-path hints (strongest individual signal — single match = score 1)

- `AGENTS.md`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`
- Any `.md` path token
- `docs/...`, `docs/`
- `.specnaut/...` (the workspace docs surface)

### Verb hints

- `write`, `document`, `draft`, `note down`, `add a note`
- `rephrase`, `tweak`, `polish`, `clarify wording`
- `rename`, `update wording`, `fix wording`
- `clean up`, `tidy`, `format`

### Subject hints

- `doc`, `documentation`, `docs`, `guide`
- `section`, `paragraph`, `wording`, `phrasing`
- `comment`, `comments` (when the brief is about comment text, not
  code-level comment cleanup)
- `agent definition`, `agent markdown`, `agent file`
- `prompt`, `system prompt`, `instruction`

### Length hint

- Brief length ≤ 150 characters → **+1** (weak signal — small briefs
  often describe small work).

## Suppressors (each hit subtracts 2)

These keywords reliably indicate non-trivial scope. A single suppressor
is usually enough to keep the full chain.

- `system`, `service`, `subsystem`
- `API`, `endpoint`, `HTTP`, `webhook`, `RPC`
- `schema`, `migration`, `database`, `data model`
- `test suite`, `test harness`, `integration test`
- `feature flag`, `feature toggle`, `experiment`
- `auth`, `authentication`, `authorization`, `OAuth`, `OIDC`, `SSO`
- `pipeline`, `CI`, `release pipeline`, `Homebrew`, `binary`
- `agent` *(when paired with `pipeline` / `orchestrator` / `multi-agent`
  — a single "agent definition" mention is a subject hint, not a
  suppressor)*

## Canonical smoke inputs

Used by `tests/plugin/plugin_sync_test.ts` and any future smoke
validation. The expected routing for each:

| Brief | Expected | Why |
|---|---|---|
| `document the OSS/proprio boundary in AGENTS.md` | **lite** | path hint (`AGENTS.md`), verb (`document`), subject (`boundary` neutral); score ≥ 2 |
| `write a new agent definition for orchestrating backlog routing` | **lite** | verb (`write`), subject (`agent definition`); score ≥ 2, "orchestrating" is not a suppressor in isolation |
| `add OAuth2 login with GitHub and Google providers` | **full** | suppressor `OAuth` (×2) overwhelms any positive signal; score < 2 |

## Explicit overrides

The router's `--lite` and `--full` flags force the shape directly and
**skip this heuristic entirely**. See `SKILL.md` step 1 "Chain shape
parsing". When forced, no prompt is emitted; the chosen shape is
persisted to `.specnaut/feature.json` (`workflow_shape`) and the
spec.md frontmatter (`workflow:`).
