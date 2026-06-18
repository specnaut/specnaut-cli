# Contract: per-axis audit dispatch

Each `/{axis}-audit` skill behaves to this contract. (`{axis}` ∈ arch/sec/perf/dep/a11y.)

## Invocation

```text
/{axis}-audit                      # whole repo
/{axis}-audit --path <subtree>     # files under a subtree
/{axis}-audit --range <a>..<b>     # files changed in a commit range
/{axis}-audit --diff               # files changed on current branch vs main
```

## Behaviour

1. Parse arg. Unrecognized → print accepted forms (the four above) and STOP. No silent whole-repo.
2. Resolve scope file list: path→`git ls-files <subtree>`; range→`git diff --name-only a..b`;
   diff→`git diff --name-only main...HEAD`; whole→`git ls-files`. `--range`/`--diff` outside a git
   repo → report and stop. Empty list → "nothing in scope", STOP (no dispatch).
3. Dispatch ONLY this axis's auditor agent (table in data-model.md) with the resolved file list +
   audit framing. One agent, never a team, never another axis.
4. Return the agent's findings inline. The agent ends with a `REVIEW SUMMARY` block
   (review-findings-contract, #378). The skill writes NO file.

## Rules

- Read-only: `git status` unchanged after a run.
- Distinct from `/specflow audit <axis>` (writes a dated report) and `/code-audit` (multi-seat team)
  — each SKILL.md states this.
