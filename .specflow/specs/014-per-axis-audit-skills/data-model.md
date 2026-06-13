# Data Model — Per-axis audit-dispatch skills

No runtime store. The model is the axis→agent binding and the uniform scope shape. Asserted by
skill-content + bundle-inclusion tests.

## Entity: Axis skill (aggregate root)

Identity = skill name. Binds one axis to exactly one auditor agent. Read-only; output = the agent's
inline findings.

| name | dispatches |
|---|---|
| arch-audit | architecture-auditor |
| sec-audit | security-auditor |
| perf-audit | performance-auditor |
| dep-audit | dependency-auditor |
| a11y-audit | a11y-auditor |

## Value object: Scope(shape, selector)

- `shape` ∈ {`path`, `range`, `diff`, `whole`}
- `selector` — the `<subtree>` / `<a>..<b>` / (none) per shape
- Resolution: `path`→`git ls-files <subtree>`; `range`→`git diff --name-only a..b`;
  `diff`→`git diff --name-only main...HEAD`; `whole`→`git ls-files`

## Invariants

- One axis skill → exactly one auditor agent (its own axis); never a team, never another axis.
- No report file written (distinguishes from `/specflow audit <axis>`).
- Read-only: dispatch mutates no tracked files.
- Unknown argument ⇒ stop with accepted-forms message (no silent whole-repo).
- Empty resolved scope ⇒ no dispatch ("nothing in scope").
- The four scope shapes behave identically across all five skills.
- The dispatched agent emits a `REVIEW SUMMARY` block (inherited, #378).
