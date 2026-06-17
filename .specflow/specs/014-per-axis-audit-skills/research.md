# Research — Per-axis audit-dispatch skills

## Decision 1 — Skill shape (thin orchestrator, no script)

**Decision**: Each `/{axis}-audit` is a markdown orchestrator skill. Its body: (1) parse the
optional scope arg (`--path`/`--range`/`--diff`/none); reject unknown args with the accepted-forms
message; (2) resolve the file/commit list for that scope (`--path` = subtree via
`git ls-files <path>`; `--range a..b` = `git diff --name-only a..b`; `--diff` =
`git diff --name-only main...HEAD`; none = `git ls-files`); stop if the resolved scope is empty; (3)
dispatch the ONE matching auditor agent with the scope + an audit framing; (4) return the agent's
findings inline (it emits REVIEW SUMMARY). No file written.

**Rationale**: Mirrors miximodel's thin `/perf-audit` shape. A single-axis dispatch needs only the
scope's file/commit list, not the category signals — so no shell script is required and there is
nothing to unit-test at the bash level. Keeps the five skills genuinely thin.

**Alternatives considered**: reuse `collect-audit-scope.sh` (#379) for scope resolution — viable for
`--path`/`--range`/whole, but it emits category signals these skills don't use and lacks `--diff`;
describing the 3–4 git one-liners in the skill body is simpler and dependency-free. (A skill MAY
call the script if a project has it, but MUST NOT require it.)

## Decision 2 — Five near-identical skills, one binding each

**Decision**: Author five sibling SKILL.md files with a consistent structure; the only substantive
difference is the bound agent + axis-specific framing line. Each documents its agent, the scope
args, and the 3-way disambiguation (vs `/specflow audit <axis>` report-writing, vs `/code-audit`
team).

**Rationale**: Consistency makes them learnable as a family (SC-002) and keeps the content test
simple (loop the five, assert the same invariants per skill). Markdown duplication is acceptable for
thin dispatchers; factoring would add indirection for no runtime benefit.

## Decision 3 — Distribution: markdown-only → mirror to plugin

**Decision**: Register the five skills in `templates/manifest.json`, regenerate the bundle, AND
mirror to `plugin/skills/<axis>-audit/` with `plugin_sync_test.ts` SYNC pairs — because they are
markdown-only (no `scripts/`), unlike the script-backed `code-audit`/`backlog` which the plugin
omits.

**Rationale**: The plugin ships markdown skills; these qualify. Consistent with the established
plugin-mirror rule confirmed in #378/#379 review.

## Axis → agent → skill name (authoritative)

| Skill        | Agent                | Axis framing                                        |
| ------------ | -------------------- | --------------------------------------------------- |
| `arch-audit` | architecture-auditor | layering / DDD / SOLID / DRY                        |
| `sec-audit`  | security-auditor     | authz / inputs / secrets / injection                |
| `perf-audit` | performance-auditor  | N+1 / hot paths / re-renders / caching              |
| `dep-audit`  | dependency-auditor   | ranges / lockfiles / unused / licenses / typosquats |
| `a11y-audit` | a11y-auditor         | WCAG 2.1 AA over FE source                          |
