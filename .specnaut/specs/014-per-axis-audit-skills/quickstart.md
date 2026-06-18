# Quickstart — per-axis audit-dispatch skills

## What ships

Five thin read-only skills — `/arch-audit`, `/sec-audit`, `/perf-audit`, `/dep-audit`, `/a11y-audit`
— each dispatching its one auditor agent over an optional scope (`--path`/`--range`/`--diff`/whole),
no report file.

## Build & test

```bash
cd apps/specflow-cli
deno task bundle
deno task test     # bundle + per-axis skill content/inclusion/mapping + plugin-sync
```

## Manual verification

```bash
# all five present, bundled, and read-only/disambiguated
for a in arch sec perf dep a11y; do
  test -f templates/core/skills/$a-audit/SKILL.md && echo "ok $a-audit"
done
grep -c "perf-audit" src/templates_bundle.ts                 # > 0
grep -q "specflow audit" templates/core/skills/sec-audit/SKILL.md   # disambiguation note present
```

## End-to-end (behavioural)

Run `/sec-audit --path <subtree>`: the security-auditor is dispatched over that subtree and returns
findings + a `REVIEW SUMMARY`; `git status` shows no new file. Run `/perf-audit --frobnicate` (bad
arg): it prints the accepted forms and stops.

## Success signals

- `deno task test` green incl. the new per-axis test.
- Each skill dispatches exactly its axis; none writes a report file.
- Unknown arg rejected with accepted-forms; empty scope → no dispatch.
- `specflow init`/`upgrade` deliver all five.
