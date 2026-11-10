# Plan — the smoke workflow goes green: re-aim or retire the assertions the templates outgrew (cli#773)

Linked item: specnaut-cli#773 "The smoke workflow is red on main: seven assertions read text the
templates no longer carry" — https://github.com/specnaut/specnaut-cli/issues/773. Branch
`071-smoke-green`, base `origin/main` @ `61323ad4`.

Brief (step 4a): test-only change to two smoke scripts; no shipped file, agent surface or trust
boundary changes, so no step-4b threshold line is crossed.

## 1. Task and out of scope

Make `smoke` green on `main` by resolving each red assertion one way, decided per assertion: the
rule still holds → the assertion reads the rule's current wording in the file that now carries it;
the rule was retired → the assertion is removed, the retiring commit cited in the commit message.

**What is actually red** (CI run 42755733072 on `61323ad4`, reproduced locally — § 4): five
assertions in two scripts, `red: smoke-agents.sh smoke-contracts.sh`. The item's "two coverage-audit
checks" are not failures: the log shows `✓ smoke-audit.sh` and `✓ audit.sh`; the
`expected coverage
in: smoke-features.sh …` line is `smoke-audit.sh` printing its own synthetic
fixture (`templates/core/agents/new-fake-agent.md`), and `SUITE: 2 CHECK(S) FAILED` counts the two
red scripts. Nothing changes in the audit; its AC is met once the two scripts are green.

**Out of scope**: other workflows; rewording any guarded rule (no file under `templates/` or
`plugin/` changes); new smoke coverage (cli#769); the audit scripts.

### Assertion → decision

Path mapping: the suite asserts on an installed tree. `.claude/agents/<a>.md` ←
`templates/core/agents/<a>.md`; `.claude/skills/task/**` ← `templates/core/skills/task/**`.
`.claude/skills/task/backlog.md` is backend-rendered; the line used below (template line ~261) sits
outside every `BEGIN: backend=` block, so every backend keeps it.

| #  | Assertion (script)                                                                          | Decision                           | Evidence commit                                                                                                                                                                                                                                                                                     | New text read                                                                                                                                                                                                                                                       |
| :- | :------------------------------------------------------------------------------------------ | :--------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 | "PO doc references cascade-check.sh as the close gate" (`smoke-agents.sh`)                  | **holds — re-aim**                 | `103be0dd` fix(backlog): narrow the product owner's tool grant — the PO lost its shell; the cascade call moved to the executor (`templates/core/skills/task/scripts/_apply_plan.sh`, `cascade-check.sh` before every close) and the session protocol got one home, `task/backlog.md`                | `` `cascade-check.sh <num>` is the close gate `` in `.claude/skills/task/backlog.md` **and** `The executor runs the cascade check before every` in `.claude/agents/product-owner.md`                                                                                |
| A2 | "PO agent has full Bash allowlist" (`smoke-agents.sh`)                                      | **retired — remove**               | `103be0dd` — grant narrowed to `Read, Grep, Glob` on purpose ("The product owner proposes; a bundled executor applies")                                                                                                                                                                             | — . Not flipped to the new grant: which seat holds which tools is decided in `tests/templates/agent_tools_pinned_test.ts` ("decided here and nowhere else", #573), which already pins `product-owner → Read, Grep, Glob`; a smoke pin would be a second decider     |
| A3 | "PO agent forbids legacy agent-memory path" (`smoke-agents.sh`)                             | **retired — remove**               | `103be0dd` — deleted the "First action in every session" section that carried "**Never** write to an `agent-memory/` folder"; the seat holds no `Write`/`Edit`, so it writes no folder at all. `git grep agent-memory templates/core` → nothing                                                     | — . The neighbouring "PO agent documents memory home path" stays (green). Section banner `#258  PO Bash allowlist + memory-home directive` becomes `#258  PO memory-home directive`                                                                                 |
| A4 | "the review phase stops the run when a seat did not report" (`smoke-contracts.sh`)          | **holds — re-aim**                 | `cd458ffd` fix(review): … check their helper scripts … — "review.md stays under its size: … its missing-seat stop [moves] to review-seats.md, each behind a pointer"                                                                                                                                | `the run **does not reach the merge prompt**` in `.claude/skills/task/phases/review-seats.md` (§ A missing seat stops the run) **and** the consumer's pointer `A seat that did not report stops the run before the merge` in `.claude/skills/task/phases/review.md` |
| A5 | "and re-dispatching narrower is allowed, repeating the brief is not" (`smoke-contracts.sh`) | **holds — re-aim the second half** | `cd458ffd` — the pointer `§ Your own checking, and re-dispatch` left `review.md` with the stop it belonged to; it now reads `The remedy is § Your own checking, and re-dispatch.` in `review-seats.md`. The first half (`repeating the same brief is not a remedy`, added `eb4d271a`) still matches | `repeating the same brief is not a remedy` **and** `**narrower** brief second` **and** `The remedy is § Your own checking, and re-dispatch.`, all in `.claude/skills/task/phases/review-seats.md`                                                                   |

**Why A4 does not keep `SEATS_REPORTED <` alone** (superseded in part by § 4 S/A-1, which ties the
trigger to the consequence in one anchor): in `review-seats.md` that literal wraps across lines in
the stop section and appears whole only in the aggregation-trigger paragraph, which "the
aggregation's own restatement carries the third trigger too" already reads. Re-pointing the grep
there would pass on a mutant that deletes the stop — it must anchor on the stop sentence.

## 2. Guardrails

### Requirements

| Id   | Requirement                                                                                                                                                                                                                                                                  | Check                                                                                           |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| FR-1 | Every assertion red on `61323ad4` is resolved per the table above — the set is enumerated by `grep '❌'` over `run-all.sh --only smoke-agents.sh` and `--only smoke-contracts.sh` (5 lines)                                                                                  | both scripts report `0 CHECK(S) FAILED`                                                         |
| FR-2 | A1 is observed red against a mutant of each text it guards, then green: (a) delete `is the close gate` from `templates/core/skills/task/backlog.md`; (b) delete `The executor runs the cascade check before every` from `templates/core/agents/product-owner.md`             | `run-all.sh --only smoke-agents.sh` shows ❌ on A1 per mutant; `git checkout -- templates/` → ✓ |
| FR-3 | A4 red against: (a) the stop sentence removed from `review-seats.md` § A missing seat stops the run; (b) the pointer sentence removed from `review.md`; (c) the stop's trigger (`SEATS_REPORTED <` / `SEATS_EXPECTED`) deleted or changed in that same sentence (§ 4, S/A-1) | `run-all.sh --only smoke-contracts.sh` ❌ on A4 per mutant, ✓ restored                          |
| FR-4 | A5 red against: (a) `repeating the same brief is not a remedy` removed; (b) `**narrower** brief second` removed; (c) `The remedy is § Your own checking, and re-dispatch.` removed — all in `review-seats.md`                                                                | as FR-3, ❌ on A5 per mutant                                                                    |
| FR-5 | A2, A3 removed; the commit body cites `103be0dd` for both, and `cd458ffd` for A4/A5                                                                                                                                                                                          | `git show -s`                                                                                   |
| FR-6 | No other assertion changes except the two `^tools:` greps removed per § 4 A-3, and no file outside `scripts/smoke/smoke-agents.sh`, `scripts/smoke/smoke-contracts.sh` (plus this spec and `.specnaut/feature.json`)                                                         | `git diff --stat origin/main`                                                                   |
| FR-7 | The whole suite, including the coverage audit, is green                                                                                                                                                                                                                      | `bash scripts/smoke/run-all.sh` exit 0, ends `✓ audit.sh` with no `red:` line                   |

Each mutant is applied to the template (the suite re-bundles from `templates/`), run, and reverted
with `git checkout -- templates/`; the bundle is restored by `run-all.sh`'s exit trap.

### Decision table

| The decision                                                                             | Its single home                                                                                                                          | What would duplicate it                                                       |
| :--------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| An epic with an open child cannot be closed                                              | `templates/core/skills/task/backlog.md` § Closing a parent (protocol); enforced by `_apply_plan.sh`                                      | a close-gate description re-added to the PO agent beyond its one-line pointer |
| Which tools any seat holds (product owner, `specnaut-guide`, `security-expert` included) | `tests/templates/agent_tools_pinned_test.ts`                                                                                             | a `^tools:` grep in any smoke script                                          |
| A seat that did not report stops the run before the merge                                | `templates/core/skills/task/phases/review-seats.md` § A missing seat stops the run                                                       | the stop restated in `review.md` beyond its pointer                           |
| Re-dispatch narrower, never the same brief                                               | `review-seats.md` § Your own checking, and re-dispatch                                                                                   | the rule restated in `review.md`                                              |
| No new helper                                                                            | — (a) inventoried: `check` in `scripts/smoke/_common.sh`, `run-all.sh --only`; (b) no recurrence evidence needed; (c) **reuse directly** | a mutation-runner script added for this item                                  |

Constitution (monorepo; the CLI half carries none of its own): § I — public repo; the change names
nothing private. § XI — no consumer project appears in the scripts or the commit. § IX — the item is
the dogfooding filing for a red gate; nothing is worked around.

**Surface:** two smoke scripts, test code only; no interface contract exposed. **Surfaces added or
widened: none** — checked: no file under `templates/`, `plugin/`, `src/` or `.github/` changes; no
agent tool grant, hook, input path or outbound call is touched.

## 3. Done, as runnable checks

```bash
cd /Users/kevin/Sites/specnaut-wt-cli-071
bash scripts/smoke/run-all.sh --only smoke-agents.sh      # 0 CHECK(S) FAILED
bash scripts/smoke/run-all.sh --only smoke-contracts.sh   # 0 CHECK(S) FAILED
# FR-2..FR-4: per mutant — edit the template, rerun the --only line, see ❌ on the
# named check, then: git checkout -- templates/ && rerun → ✓
bash scripts/smoke/run-all.sh                             # exit 0, ✓ audit.sh, no `red:` line
git diff --stat origin/main                               # FR-6
git status --short                                        # clean: bundle restored
```

No `run-gate.sh` and no `size-limits.md` exist in this repo; `deno task test` is unaffected (no
`src/`, `templates/` or `tests/` change). The landing push runs `smoke.yml`, which must be green on
`main` (item AC).

One commit:
`test(smoke): re-aim the close-gate and missing-seat assertions, drop the two the
product owner's narrowed grant retired`,
body citing `103be0dd` (A1–A3) and `cd458ffd` (A4, A5), and `Closes #773`.

## 4. Audit findings

All three accepted.

- **S/A-1 — Security LOW / Architecture LOW (merged).** A4's anchor must tie the trigger to the
  consequence: a grep on the consequence alone passes on a mutant that guts the trigger. A4 anchors
  on the sentence at `templates/core/skills/task/phases/review-seats.md` (~:131-132) that carries
  both `SEATS_EXPECTED` and "the run **does not reach the merge prompt**"; the sentence wraps, so
  the file is flattened (`tr '\n' ' '`) and matched with `grep -qF` on
  `` `SEATS_REPORTED < SEATS_EXPECTED`, the run **does not reach the merge prompt** ``. FR-3 gains
  mutant (c): deleting or changing the `SEATS_REPORTED <` / `SEATS_EXPECTED` trigger turns A4 red.
- **A-2 — Architecture LOW.** A1's check label and section banner (`smoke-agents.sh` ~161, 164) and
  A4's comment (`smoke-contracts.sh` ~103-104) are renamed to describe what they now read: the close
  gate is `cascade-check.sh` in `task/backlog.md`, the product owner points at the executor; the
  missing-seat stop lives in `review-seats.md`, `review.md` carries its pointer.
- **A-3 — Architecture MEDIUM.** Two more `^tools:` greps duplicate the pinned tool table
  (`tests/templates/agent_tools_pinned_test.ts`, "decided here and nowhere else"): `smoke-agents.sh`
  ~192 (`specnaut-guide` holds Bash and Agent) and `smoke-contracts.sh` ~137 (`security-expert`
  grants no Bash). Same defect class as A2: both are removed in the implementation commit, citing
  the pin. Confirmed: the pin asserts by exact equality
  `specnaut-guide → Read, WebFetch, Grep, Glob, Bash, Agent(developer)` and
  `security-expert → Read, Grep, Glob`, which is strictly stronger than either grep; both seats'
  basenames stay covered by other smoke checks, so the coverage audit loses nothing.

Reproduction already done on `61323ad4`: `run-all.sh --only smoke-agents.sh` → the three A1–A3 ❌,
`--only smoke-contracts.sh` → the two A4–A5 ❌, matching CI.

## 5. Open questions

None.

## Decided here

- The item's "two coverage-audit checks" are not failures (log evidence in § 1); no audit change.
- The item's "seven assertions" are five; the count is corrected in this brief, not in the item.
- A2 is removed, not flipped: the tool grant has a single decider in the unit pin.
- A4 anchors on the stop sentence with its trigger (`SEATS_REPORTED < SEATS_EXPECTED`) in one
  flattened match, so neither the trigger nor the consequence can be mutated away unseen (§ 4).
- No smoke script greps a seat's `tools:` line; the pin is the only decider (§ 4 A-3).
- No mutation helper is built; mutants are manual edits reverted with `git checkout`.
