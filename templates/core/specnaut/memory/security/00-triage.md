# Triage — before you report anything

Read this before every security review. It is short on purpose.

## A pattern match is not a vulnerability

The most common failure mode in automated security review is reporting
unreachable or already-mitigated code. It is worse than reporting nothing:
it buries the one real finding under nine false ones, and it trains the
reader to skim the report.

**Confirm all three before you write a finding.**

### 1. Is the input actually attacker-controlled?

Trace it back to a real entry point — a request parameter, header, cookie,
uploaded file, webhook body, queue message, or third-party API response.

**When the consumer is an AI agent, the entry points are different ones**: a
tool result, a fetched page, a file the agent reads, an issue or pull-request
body, a repository the agent was pointed at, and the model's own response
where something downstream acts on it. Each is text an agent may read as
instruction. See `11-ai-and-agentic-surface.md`.

A value that only ever comes from a constant, an enum, a database column
the user cannot write, or trusted internal config is **not** an injection
source. Say so and move on.

That last case has one exception, and only one. **Internal configuration is
an injection source when an agent reads it as instruction and somebody
outside the trusted set can write it** — an instruction file, an agent or
skill definition, a rules file. Both halves are required: the content must
be loaded as instruction rather than parsed as data, and there must be a
writer the project does not trust. Neither alone makes a finding, and a
config file consumed by a program is still not an injection source no
matter what an agent could hypothetically do with it.

### 2. Is the sink reachable with that input?

Look for what already sits between them: validation, an allowlist, an ORM,
a framework-level control, output encoding by default.

Before flagging a route as missing authorization, look for **centralized
enforcement** — middleware, a proxy layer, a base controller, route
decorators, a policy object. Enforcement is far more often centralized than
per-route, and a per-route grep will report every route in the codebase.

### 3. What is the blast radius?

Who can trigger it, what do they get, and does it cross a trust boundary?
An SSRF that reaches a cloud metadata endpoint is not the same finding as
one that can only reach `localhost`. An IDOR over public profile data is
not the same as one over invoices.

## Severity by exploitability, not by pattern

Rank by what an attacker actually achieves, not by how alarming the
function name looks.

| Severity | Meaning |
|---|---|
| **CRITICAL** | Unauthenticated remote attacker gains code execution, admin access, or bulk access to sensitive data. Also: a live credential committed to the repository. |
| **HIGH** | Authenticated attacker escalates privilege, reaches another tenant's or user's data, or a single-user compromise is straightforward. |
| **MEDIUM** | Requires unusual conditions, yields limited data, or is a meaningful weakening of defence in depth. |
| **LOW** | Hardening gap with no demonstrable path to impact today. |
| **INFO** | Observation worth recording; no action required. |

Two adjustments that matter more than the table:

- **Exposure raises severity.** The same defect is more severe on an
  unauthenticated public endpoint than behind an admin login.
- **Compensating controls lower it.** A rate limit, a WAF rule, or a
  network boundary in front of the defect is part of the assessment — note
  it explicitly rather than silently ignoring it.

## Say which kind of finding it is

Label every finding as one of:

- **Exploitable** — you can state the concrete path: *this input reaches
  this sink, and here is what the attacker gets.*
- **Defence in depth** — no current path to impact, but the control is
  missing and a future change would expose it.
- **Undetermined** — reachability cannot be settled from the code
  available. Say that plainly. Do not assert either way, and do not inflate
  it to look thorough.

An honest *undetermined* is worth more than a confident guess.

## Finding format

```
FINDING <n> — <one-line title>
  Severity  : CRITICAL | HIGH | MEDIUM | LOW | INFO
  Kind      : exploitable | defence-in-depth | undetermined
  Location  : <path>:<line>
  Standard  : <OWASP A0X:2025 / LLM0X:2025 / ASVS V<n>.<n>.<n> / CWE-nnn>
  Path      : <entry point> -> <intermediate> -> <sink>
  Impact    : <what the attacker gets, concretely>
  Fix       : <the change to make, specific to this code>
```

`Path` is the field that makes a finding credible. If you cannot fill it
in, the finding is `undetermined` — mark it as such.

## Rules for the report

1. **Order by severity, not by file order.** The reader stops early.
2. **One finding per defect**, not one per occurrence. Ten call sites of
   the same unsafe helper is one finding listing ten locations.
3. **Every finding gets a fix.** A finding without a remediation is a
   complaint. Cite the secure pattern from the relevant domain file.
4. **Never include a real secret value in the report.** Report the
   location, the kind of credential, and that it must be rotated —
   never the value itself, not even truncated.
5. **Report the absence of findings plainly.** "No findings in scope" is a
   valid, useful result. Do not manufacture LOW findings to look thorough.
6. **Do not report style, formatting, or non-security refactors.** Other
   reviewers own those axes.
