---
name: alert-triage-contract
description: Defines the security-expert's alert-triage mode — the per-alert workflow, the constrained Bash allowlist, the resolution values each GitHub endpoint accepts, and the VERDICT line. Preloaded, not user-invocable.
user-invocable: false
---

# alert-triage-contract

Preloaded by `security-expert`. Split out of that agent under #562, when the
emitted Windsurf workflow had 49 characters of room left and no duplication to
reclaim — the seat and its triage procedure change for different reasons, and
the procedure is long enough to be worth reading on its own.

**Nothing was cut in the move.** In particular the Bash constraint below is the
*entire* limit on an agent whose frontmatter grants `Bash` unconditionally, and
the per-endpoint `resolution` values are an allowlist, not a repetition — each
endpoint's list genuinely differs.

Spawned by the local `/release` session AFTER the `security-preflight`
job in `release.yml` surfaces open GitHub-side security alerts (secret
scanning, dependabot, code scanning, private advisories). The dispatch
prompt provides the alert payload as JSON.

## Per-alert workflow

For each alert, decide ONE of three actions:

1. **Real risk** — open a backlog ticket via the `product-owner`
   subagent. Title format: `security: <one-line summary>`. Body
   includes the alert URL, the affected file/dep, severity-derived
   priority (CRITICAL→P0, HIGH→P1, MEDIUM→P2, LOW→P3), and concrete
   AC pointing at the fix. Do NOT auto-close the alert — the fix PR
   will close it on merge.
2. **False positive / used in tests** — dismiss the alert directly via
   `gh api -X PATCH` with the appropriate `dismissed_reason`.
3. **Escalate** — if the alert needs the user's judgement (e.g. unclear
   exploitability, dep needs a major bump that breaks compat),
   surface it in the report without action; let the main session
   decide.

## Allowed Bash usage (constrained)

`Bash` is granted ONLY for the `gh api` calls listed below. Do NOT run
arbitrary shell commands. Do NOT chain commands. Do NOT redirect to
files. Each invocation is one `gh api` call with the specific shape:

- Secret scanning dismissal:
  ```bash
  gh api -X PATCH "repos/<owner>/<repo>/secret-scanning/alerts/<num>" \
    -f state=resolved \
    -f resolution=<reason> \
    -f resolution_comment="<≤280 char justification>"
  ```
  Valid `resolution` values: `false_positive`, `wont_fix`, `revoked`,
  `used_in_tests`, `pattern_deleted`, `pattern_edited`. Anything else
  is rejected by the API.

- Code scanning dismissal:
  ```bash
  gh api -X PATCH "repos/<owner>/<repo>/code-scanning/alerts/<num>" \
    -f state=dismissed \
    -f dismissed_reason=<reason> \
    -f dismissed_comment="<justification>"
  ```
  Valid `dismissed_reason` values: `false positive`, `won't fix`, `used
  in tests` (note the spaces — these are literal accepted strings).

- Dependabot alert dismissal:
  ```bash
  gh api -X PATCH "repos/<owner>/<repo>/dependabot/alerts/<num>" \
    -f state=dismissed \
    -f dismissed_reason=<reason> \
    -f dismissed_comment="<justification>"
  ```
  Valid `dismissed_reason` values: `fix_started`, `inaccurate`,
  `no_bandwidth`, `not_used`, `tolerable_risk`.

Anything outside these three shapes is forbidden.

## Output format (Mode 2)

One row per alert in a final summary table:

```
| Alert # | Type             | Severity | Action                               |
| ------- | ---------------- | -------- | ------------------------------------ |
| 1       | stripe_api_key   | n/a      | resolved: used_in_tests              |
| 2       | npm:lodash       | high     | ticket #N created (P1)               |
| 3       | reflected XSS    | medium   | escalated: needs human review        |
```

End with a `VERDICT` line: `clean` (all alerts dismissed or ticketed),
`escalation_needed` (one or more alerts surfaced for the user), or
`error` (a triage step failed).
