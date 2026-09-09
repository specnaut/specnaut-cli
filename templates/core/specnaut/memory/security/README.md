# Security knowledge base

Durable, offline security reference for this project. Every file here is
local — an agent reviewing code never needs network access, and never has an
excuse to skip the research step.

**Read `00-triage.md` first, always.** It is the gate that separates a real
finding from a pattern match. Then load only the domain file that matches
what you are looking at.

## Routing table — symptom to file

| What you are looking at | Load |
|---|---|
| A route, handler, or query that returns someone's data | `01-access-control.md` |
| Login, signup, password reset, session, token, SSO | `02-authentication-and-sessions.md` |
| Any place user input reaches an interpreter, parser, or the DOM | `03-injection-and-input.md` |
| Hashing, encryption, TLS, keys, tokens, anything named `*_SECRET` | `04-cryptography-and-secrets.md` |
| Framework config, env files, headers, cloud permissions, defaults | `05-configuration-and-hardening.md` |
| Manifests, lockfiles, CI workflows, install scripts, CDN tags | `06-supply-chain-and-integrity.md` |
| PII, exports, backups, caches, client-side storage | `07-data-protection.md` |
| Log statements, `catch` blocks, error responses, alerting | `08-logging-and-error-handling.md` |
| A feature with no obvious bug that still feels abusable | `09-design-and-business-logic.md` |
| Language-specific footguns once you know the stack | `10-language-footguns.md` |

A single finding often spans two files. An unauthenticated endpoint that
concatenates SQL is both `01` and `03` — read both and report the more
severe.

## How the domain files are shaped

Every domain file uses the same six sections, so you can jump straight to
the one you need:

- **Attack surface** — what an attacker targets here, in one paragraph.
- **Where to look** — concrete search signatures. Start here; it turns a
  vague audit into a file list.
- **Failure modes** — the catalogue. Each entry gives the defect, how it is
  exploited, **how to confirm it is real**, and a default severity.
- **Secure patterns** — unsafe/safe pairs to cite in a remediation.
- **When it is NOT a finding** — the shapes that look exactly like a hole and
  are not. Read it looking for the reason *you* are wrong, before you write the
  finding, not after somebody else does.
- **Review checklist** — the pass/fail list to run before signing off.

## Standards this base tracks

- **OWASP Top 10:2025** — the ten categories, mapped onto the domain files
  above. Three categories were renamed in 2025 and two are new; the old
  names are a reliable tell that a reference is stale.
- **OWASP ASVS 5.0** (May 2025) — verification requirements, cited as
  `V<chapter>.<section>.<req> [level]`. **ASVS 5.0 renumbered everything —
  4.0 IDs do not map onto it.** `V2.1.1` meant "password length" in 4.0 and
  means something else now. Cite 5.0 IDs only.

### OWASP Top 10:2025 to domain file

| # | Category | Domain file |
|---|---|---|
| A01 | Broken Access Control | `01-access-control.md` |
| A02 | Security Misconfiguration | `05-configuration-and-hardening.md` |
| A03 | Software Supply Chain Failures *(new)* | `06-supply-chain-and-integrity.md` |
| A04 | Cryptographic Failures | `04-cryptography-and-secrets.md` |
| A05 | Injection | `03-injection-and-input.md` |
| A06 | Insecure Design | `09-design-and-business-logic.md` |
| A07 | Authentication Failures *(renamed)* | `02-authentication-and-sessions.md` |
| A08 | Software or Data Integrity Failures *(renamed)* | `06-supply-chain-and-integrity.md` |
| A09 | Security Logging and Alerting Failures *(renamed)* | `08-logging-and-error-handling.md` |
| A10 | Mishandling of Exceptional Conditions *(new)* | `08-logging-and-error-handling.md` |

### ASVS 5.0 chapters

| # | Chapter | # | Chapter |
|---|---|---|---|
| V1 | Encoding and Sanitization | V10 | OAuth and OIDC |
| V2 | Validation and Business Logic | V11 | Cryptography |
| V3 | Web Frontend Security | V12 | Secure Communication |
| V4 | API and Web Service | V13 | Configuration |
| V5 | File Handling | V14 | Data Protection |
| V6 | Authentication | V15 | Secure Coding and Architecture |
| V7 | Session Management | V16 | Security Logging and Error Handling |
| V8 | Authorization | V17 | WebRTC |
| V9 | Self-contained Tokens | | |

ASVS levels are defined by share of requirements, not by application
category: **L1** ≈ 20% (minimum bar), **L2** ≈ 50% more (~70% cumulative —
what most applications should target), **L3** the remaining ~30% (highest
assurance). Tailor a profile: drop chapters you do not use, start at L1,
advance on risk.

## Deliberate gaps

- **Dependency CVE triage** is only sketched in `06`. The dedicated
  `dependency-expert` agent owns manifests, advisories, and licences —
  hand off rather than duplicating its work.
- **Runtime and infrastructure security** (container escape, network
  segmentation, host hardening) is out of scope: this base is for
  reviewing *source code*.
- **The AI/agentic attack surface** (OWASP LLM Top 10, Agentic Top 10:
  prompt injection, tool misuse, memory poisoning, excessive agency) is
  **in scope and not yet written** — a gap being closed, not a boundary.

  The source-code frame above cuts this class in two, and the halves land
  on opposite sides. Instruction files, tool and permission declarations,
  MCP configuration, hook scripts and skill definitions are **checked-in
  source**, and reviewing them is exactly what this base is for. Judging
  what an agent did at run time — its live tool calls, its accumulated
  memory, the text a model returned — is not source review and sits with
  the runtime gap above.

  This entry used to say *"add it if this project builds or embeds LLM
  features"*. That discriminator is withdrawn: it keys on whether the
  application calls a model, while the exposure runs the other way —
  whether this repository holds instructions an agent reads and acts on.
  Most projects are the second and not the first, so the condition was
  false in exactly the population that needed it. **If an agent acts on
  anything in this repository, this class applies to you.**

  Closing it is one change, not two. `00-triage.md` § 1 enumerates
  attacker-controlled entry points and none of them is agentic, and its
  ruling that "trusted internal config is **not** an injection source"
  dismisses the main vector outright — an instruction file *is* internal
  config, and to an agent it is precisely an injection source. A chapter
  behind that gate would be inert; a widened gate with no chapter would
  produce pattern matches with nowhere to confirm them.

  Until the chapter exists, **a review that reports nothing on this class
  has not cleared it.** `security-expert` is required to say so (its Step
  0), so the silence reads as *not assessed* rather than as clean.

## Keeping it honest

These files describe mechanisms, never a specific deployment. Do not add
this project's hostnames, account identifiers, vendor names, or real
credentials to any file here — a knowledge base is exactly the kind of
document that gets copied into a public repository. Placeholders only:
`example.com`, `acme`, `my-app`.
