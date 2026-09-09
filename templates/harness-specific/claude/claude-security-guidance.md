# Security guidance for this repository

Loaded automatically by the `security-guidance` plugin as extra context for
its model-backed reviews (end-of-turn diff review and commit review). It is
additive: it sharpens the built-in checklist, it cannot switch parts of it
off.

> **Not installed?** `/plugin install security-guidance@claude-plugins-official`,
> then `/reload-plugins`. To turn it on for everyone who clones this repo,
> add `"enabledPlugins": {"security-guidance@claude-plugins-official": true}`
> to `.claude/settings.json`. Without the plugin this file is inert — the
> `security-expert` agent and `/sec-audit` still work, and read the same
> knowledge base.

## The full knowledge base lives in the repo

Do not review from memory when you can read the source of truth.
`.specnaut/memory/security/` holds the complete catalogue — failure modes,
confirmation steps, severities, and secure patterns, organised by attack
surface:

| Looking at | Read |
|---|---|
| routes, ownership, tenancy, roles | `01-access-control.md` |
| login, sessions, tokens, reset | `02-authentication-and-sessions.md` |
| user input reaching an interpreter or the DOM | `03-injection-and-input.md` |
| hashing, TLS, keys, credentials | `04-cryptography-and-secrets.md` |
| framework config, headers, cloud permissions | `05-configuration-and-hardening.md` |
| manifests, lockfiles, CI, CDN tags | `06-supply-chain-and-integrity.md` |
| PII, exports, caches, retention | `07-data-protection.md` |
| `catch` blocks, error responses, logging | `08-logging-and-error-handling.md` |
| rate limits, flows, races, pricing | `09-design-and-business-logic.md` |
| language-specific sinks | `10-language-footguns.md` |
| agent instructions, tool grants, MCP config, hooks | `11-ai-and-agentic-surface.md` |

`.specnaut/memory/security/00-triage.md` defines the severity rubric and
the finding format. Use them rather than inventing your own.

## Before reporting: confirm reachability

A pattern match is not a vulnerability. Reporting unreachable code buries
the real findings. Confirm all three:

1. **Is the input attacker-controlled?** Trace it to a real entry point — a
   parameter, header, cookie, upload, webhook, or third-party response. A
   constant, an enum, or trusted config is not an injection source.
2. **Is the sink reachable?** Look for validation, an allowlist, an ORM, or
   framework-level encoding already in the path. Before flagging a route as
   unauthorized, check for **centralized** enforcement — middleware, a base
   controller, decorators, a policy layer.
3. **What is the blast radius?** Who triggers it, what do they get, does it
   cross a trust boundary?

State the concrete path — *this input reaches this sink*. Say explicitly
when a finding is defence-in-depth rather than exploitable, and say
"undetermined" when reachability cannot be settled from the code available.
An honest undetermined beats a confident guess.

## Non-negotiable rules for this repository

These are the ones worth re-prompting over. Everything else, use judgement.

1. **Never report a secret's value.** If a credential is found, report its
   location and kind only — never the value, not truncated, not masked.
   Recommend rotation at the issuer, not just deletion: removing it at
   `HEAD` leaves it in history.
2. **Security decisions fail closed.** Any `catch` around an authorization,
   authentication, signature, or rate-limit check must deny. A permissive
   default in an exception handler is CRITICAL regardless of how unlikely
   the exception looks.
3. **Never trust identity or authorization from the request.** Roles,
   tenant identifiers, permissions, and prices come from server-side state,
   never from a header, body field, or unverified token claim.
4. **Ownership is enforced in the query.** A record fetched by a
   user-supplied identifier needs an ownership or tenancy predicate in the
   query itself, not a check the next developer may forget.
5. **Data reaches interpreters as parameters, never as text.** Parameterized
   queries, argument arrays with the shell disabled, constant templates.
   Manual escaping is a finding, not a fix.
6. **No dynamic code execution on user input.** `eval`, `new Function`,
   `exec`, template compilation of user data.
7. **No deserialization of untrusted input in a code-executing format.**
   Verify a signature *before* deserializing, never after.
8. **Generic errors out, detail in the log.** No stack traces, SQL
   fragments, internal paths, or raw exception messages in a response.
9. **Redact at the logging layer.** Credentials, tokens, and personal data
   must not reach logs — enforced centrally, not per call site.
10. **New third-party code is pinned and verified.** Exact versions, a
    committed lockfile, digests for images and CI actions, Subresource
    Integrity for CDN assets. Never `curl … | sh`.

## Applies to generated and edited files alike

Scaffolded templates, fixtures, examples, and documentation snippets are
reviewed on the same terms. A vulnerable example is copied into production
by someone eventually, and an example is exactly what gets copied.

## Keep this file free of specifics

Do not add real hostnames, account identifiers, vendor names, or
credentials here. Describe the mechanism and use placeholders —
`example.com`, `acme`, `my-app`. This file is checked in, and a security
guidance document is precisely the kind of file that gets shared.

## Adding to this file

Project-specific rules belong here in plain language — the reviewer reads
them as additional context. Keep the combined guidance under 8 KB, which is
the plugin's cap across all scopes. Deterministic string and regex rules
belong in `.claude/security-patterns.yaml` instead. Personal overrides that
should not be committed go in
`.claude/claude-security-guidance.local.md` (add it to `.gitignore`).
