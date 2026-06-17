# Security Policy

Specnaut is a CLI distributed as a native binary (no Python prerequisites) that scaffolds files into
your project — it does NOT call any LLM and does NOT execute remote code at runtime. The attack
surface we care about is:

- The installer pipeline (`install.sh`, the Homebrew tap formula, the GitHub Releases binaries +
  their SHA-256 checksums).
- The bundled templates and skills shipped into user projects via `specnaut init` /
  `specnaut upgrade`.
- The repository's CI / release workflows.

If you find a security issue in any of those, please report it privately so it can be triaged and
fixed before public disclosure.

## Supported versions

Specnaut is shipped as a rolling binary on a single channel. We support **only the latest released
version**. Always upgrade via `specflow
self-update` (or `brew upgrade specflow`) before reporting
an issue — many fixes ship within hours and may already cover what you found.

| Version      | Supported          |
| ------------ | ------------------ |
| latest       | :white_check_mark: |
| < latest - 1 | :x:                |

The current version is published at <https://specnaut.com/version.json> and at
<https://github.com/specnaut/specnaut-cli/releases/latest>.

## Reporting a vulnerability

**Please do NOT open a public GitHub issue, discussion, or pull request for security findings.**
Public reports expose the bug to attackers before users can upgrade.

Use one of these private channels in order of preference:

1. **GitHub Private Security Advisories** (preferred, in-platform):
   <https://github.com/specnaut/specnaut-cli/security/advisories/new>. This goes directly to the
   maintainers, lets us collaborate on a fix in a private fork, and produces a CVE + GitHub Security
   Advisory when the fix ships.
2. **Email fallback**: `kevin.raimbaud@gmail.com` with subject prefix `[specflow security]`. Use
   this if you can't access the GitHub UI or want to share material that doesn't fit a GitHub form.

Please include as much of the following as you can:

- Specnaut version (`specnaut --version`) and OS / arch.
- Type of issue (e.g. supply-chain compromise, sandbox escape via a generated script, RCE in a hook,
  credential exposure in a log).
- Reproduction steps — the smallest project shape that triggers it.
- Impact: who is affected, what an attacker gains.
- Proof-of-concept if one exists. Do NOT exploit it against third-party projects.

## Response timeline

| Step                                         | Target SLA                   |
| -------------------------------------------- | ---------------------------- |
| Acknowledgement of the report                | within 3 days                |
| Initial triage (severity + accept / decline) | within 7 days                |
| Coordinated fix + release (if accepted)      | best-effort, severity-driven |
| Public advisory + CVE (if accepted)          | published with the fix       |

This is a personal-time project; SLAs are best-effort, not contractual. We'll keep you in the loop
throughout the process.

## Scope

In scope:

- Specnaut CLI binary (`init`, `upgrade`, `check`, `self-update`).
- Bundled templates under `templates/core/**`.
- Bundled skills under `templates/core/skills/**`.
- The Claude Code plugin (`plugin/**`).
- Release / install / upgrade pipelines (`install.sh`, `.github/workflows/release.yml`, the
  homebrew-tap formula).
- The `specnaut.com` docs site now lives in its own repo,
  [`specnaut/specnaut-web`](https://github.com/specnaut/specnaut-web) — report site issues there.

Out of scope:

- Vulnerabilities in upstream `specify` from GitHub Spec Kit — please report those to
  <https://github.com/github/spec-kit/security/policy>.
- Vulnerabilities in your AI harness (Claude Code, Cursor, etc.) — those belong to the harness
  vendors.
- Vulnerabilities in Deno itself or in `@std/*` — please report to the Deno project; we'll bump the
  dep once a fix is available.

## Hall of fame

We keep a short list of people who reported real, in-scope issues responsibly. Tell us if you'd like
to be credited in the eventual GitHub Security Advisory and the release notes.
