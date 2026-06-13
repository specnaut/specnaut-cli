# Quickstart — verifying the agent output contracts

## What this feature delivers

Four `user-invocable: false` contract skills in the bundle, and `skills:` frontmatter wiring on the
auditor / reviewer / qa / developer agents so their output ends with a normalized, fenced block.

## Build & test

```bash
cd apps/specflow-cli
deno task bundle      # regenerate src/templates_bundle.ts with the 4 new contracts
deno task test        # runs bundle + the new inclusion/wiring assertions
```

## Manual verification (content present)

```bash
# the four contracts exist and are non-user-invocable
for c in workflow-contract handoff-protocol review-findings-contract qa-report-contract; do
  grep -q "user-invocable: false" templates/core/skills/$c/SKILL.md && echo "ok $c"
done

# the bundle carries them
grep -c "review-findings-contract" src/templates_bundle.ts   # > 0

# a wired agent preloads the right contracts
grep -A0 "skills:" templates/core/agents/security-auditor.md   # review-findings-contract, workflow-contract
grep -A0 "skills:" templates/core/agents/qa-tester.md          # qa-report-contract, workflow-contract
```

## End-to-end (behavioural)

In a project scaffolded from this bundle, dispatch a wired agent (e.g. the security-auditor over a
small diff). Confirm its output ends with a `REVIEW SUMMARY` block whose verdict and four counts are
explicit integers, and that the human-readable prose above it is unchanged in character. Dispatch the
developer on a trivial change and confirm a `WORKFLOW STATUS` block (and a `HANDOFF` block iff
`HANDOFF_TARGET ≠ none`).

## Success signals

- `deno task test` green, including the new contract-inclusion + agent-wiring assertions.
- All four contracts present and `user-invocable: false`.
- Every wired agent carries its `skills:` entries; no agent's prose output regressed.
- `specflow init` / `specflow upgrade` in a fresh/existing project deliver the contracts (upgrade
  preserving any team-customised files per spec 011).
