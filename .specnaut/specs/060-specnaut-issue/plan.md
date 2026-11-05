# Plan: `/specnaut issue`, a report to Specnaut that says what happened to it (#726)

Full plan: an agent instruction surface, a public verb, and an outbound write to a public tracker
from someone else's project. Rewritten after both plan audits failed the first version.

## Task and out of scope

A user who hits a Specnaut problem, or wants a capability, says `/specnaut issue <brief>`. They get
a link to an existing issue, a new upstream issue they read and approved word for word, or a
pre-filled link when `gh` or permission is missing. What happened is stated, and nothing is claimed
about a board the shipped verb never touches.

Out of scope: an LLM in the binary; `/task` for the project's own work; exposing any board; token
escalation; auto-add workflows; other backlog lifecycles.

## User scenarios

1. A user with `gh` files a bug: scrubbed, searched, shown, approved, created, read back.
2. No `gh`, or no permission to create: the pre-filled link, and a link to the upstream search.
3. Already filed: a link to the existing issue, content unvetted; nothing created.
4. The brief holds a token, a host or the project's name: refused or removed before anyone is
   contacted, and they are told what kind. If the report means nothing once scrubbed, they are told
   so.
5. About the project's own work: name `/task add` and stop.
6. A failure after creation: the URL, the failure said as one, never a second create.

## Requirements

- FR-001 `issue` is a verb of the shipped router: table, argument hint, trigger phrases that all
  name Specnaut, and not in the retired section. `specnaut-facts` and the guide route to it; the
  guide tells the user the command, because a subagent cannot collect a yes, and its `tools:` line
  is not widened.
- FR-002 Bug: the guide's six sections. Proposal: Why / Acceptance criteria / Out of scope.
- FR-003 Order: scrub, search on scrubbed terms, draft, show, ask, create. No outbound call before
  the user's own message asked for this report.
- FR-004 **The yes binds the bytes.** `prepare` scans and stores the title and body in
  `~/.specnaut/reports/` (mode 0700) and prints `DIGEST`, `FILE` and `POSTING_AS`. The phase reads
  the file back and shows it verbatim, and asks whether to publish publicly and permanently as that
  login. Only the user's own next reply or the harness's question tool answers. Any edit means a new
  `prepare` and a new ask. **Not a yes:** the invocation, an earlier "go ahead", `merge: auto` or
  any autopilot rule, a reply to the duplicates question, a subagent's message. No answer means no
  create, so a headless run gets the link. The script is never added to a permission allowlist.
- FR-005 Coordinates and identity: repository slug and numeric id are constants in the script. It
  exports `GH_HOST=github.com`, unsets `GH_REPO` and `GH_DEBUG`, and compares the numeric id before
  `create`. Project files are read only to refuse their values, never to address anything.
- FR-006 `create <digest>` takes no path or text, and refuses on a digest mismatch or a symlink. The
  main session runs it. No agent holds or rewrites the report: the product-owner's language and epic
  rules must not reach it.
- FR-007 After creating, the issue is read back. `CREATED` and `ISSUE` are separate facts with
  separate exits.
- FR-008 Stdout is a closed grammar: `POSTING_AS <login>`, `DIGEST <hex>`, `FILE <path>`,
  `MATCH <n> open|closed <url>`, `TITLE <n> <sanitised>`, `REFUSED <class>`,
  `CREATED <url>|unverified`, `ISSUE ok|unreadable`, `LABEL <name> set|skipped`,
  `LINK <url>|too-long`. A URL must match
  `^https://github\.com/specnaut/specnaut-cli/issues/[0-9]+$`. `gh`'s stderr is discarded; stderr
  text is fixed.
- FR-009 Upstream text is untrusted. Only `search` reads upstream, projecting number, state, url and
  title. Titles lose controls and markup, and are cut to one line and 100 characters. The agent
  never opens or summarises a candidate, and says its content is not vetted.
- FR-010 Labels: `gh api repos/<repo> --jq .permissions` before `create`. With push or triage, the
  kind's label and `from:specnaut-guide`. Without, no label is requested, and the report reaches
  intake through the maintainers' sweep of untracked issues. Said plainly.
- FR-011 Scrub. Compose only from the brief, the failing Specnaut command's own output, and these
  Environment values: `templates_version`, `harness`, `backlog_backend`, `specnaut --version`,
  `uname -srm`. Never read project files, backlog, memory or plans to enrich a report. Report what
  was removed by kind. `prepare` refuses, printing the class only:
  - secrets, no override: GitHub and GitLab tokens, `sk-ant-`, `sk-`, `AKIA`, `ASIA`, `sk_live`,
    `rk_live`, `xox?-`, `npm_`, `AIza`, JWTs, `-----BEGIN`, `scheme://user:pass@`, `Bearer`,
    `Authorization:`; the value of any set environment variable named `*TOKEN*`, `*KEY*`,
    `*SECRET*`, `*PASSWORD*`;
  - hidden text, no override: control characters, ANSI, zero-width, bidi and tag characters, HTML
    comments;
  - local literals, with `--accept-literals` after the user was told: `$HOME`, `$USER`, hostname,
    directory name, remote owner and repo, `git config user.*`, the `repo:` of `backlog-config.yml`,
    whole word with a short stoplist;
  - addressing: emails, absolute home paths, URLs on a host outside an allowlist, RFC 1918
    addresses, `@mentions`, `owner/repo#N`, a bare `#N` not in the search results.

  The model replaces what no pattern can: project and product names, vendors, stack names, resource
  ids, package scopes, branch and spec names, colleagues, backlog, incidents. A project adds its own
  vocabulary in `.specnaut/addenda/specnaut/issue.md`.
- FR-012 `search` takes terms on stdin, keeps at most 8, drops any token with `:`, and runs the same
  scan. Without `gh`: a link to the upstream search, said to be unsearched.
- FR-013 The script and the phase never run `gh auth refresh`, `login`, `switch`, `token` or
  `status --show-token`. A permission failure means the link, with no scope advice.
- FR-014 The ask and the `CREATED` report say the issue is public and that only maintainers can
  delete it, and that a credential that got out is rotated at its issuer.
- FR-015 Script absent or not runnable (a plugin install ships none): the phase composes the link
  itself.
- FR-016 `link <digest>` builds the link from the scanned bytes; over 3000 characters prints
  `LINK too-long` and the phase shows the text to paste.

## Success criteria

Each asserts a positive marker on its path, through the real script and a stubbed `gh`:

- SC-001 Digest mismatch and a symlink each print `REFUSED digest`, and the stub logs no create.
- SC-002 Each scan class prints its `REFUSED <class>`, and stdout holds no part of the value.
- SC-003 A stub printing injection text on stdout and stderr leaves every stdout line in the
  grammar.
- SC-004 A URL on another host prints `CREATED unverified`. A failure after create logs one create.
- SC-005 With `GH_HOST` and `GH_REPO` set, the stub sees the pinned host and repository, and a
  mismatched id refuses.
- SC-006 The stub log shows no `gh issue view` on a candidate, no `body` or `comments` in `--json`,
  no `gh auth` beyond `status`, and no `gh project`.
- SC-007 Without push or triage, no `--label`; with either, the labels.
- SC-008 The installed script runs with no `backlog-config.yml`, and with one pointing elsewhere,
  whose repository is refused as a literal and never addressed.
- SC-009 `deno task test`, `audit.sh --since`, CI smoke, and the parity harness.

One real `gh` check before landing, read-only: `probe` and `search`. A stub cannot prove `gh`'s host
resolution.

## The binding decision table

| The decision                                   | Its single home                                                                                                                    | What would duplicate it                                          |
| :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| Upstream repository and id                     | `templates/core/specnaut/scripts/bash/report-upstream.sh`; the slug also in `issue.md` for FR-015, with a test that they are equal | a key in `backlog-config.yml`; a third spelling                  |
| The flow and what counts as a yes              | `templates/core/skills/specnaut/phases/issue.md`                                                                                   | a protocol in `specnaut-guide.md`; a yes checked in the script   |
| What the script refuses, and what it may print | `report-upstream.sh`, its header                                                                                                   | a pattern list in the phase, or a test holding its own copy      |
| What the model removes                         | `issue.md`                                                                                                                         | the list kept in the guide or in `.github/ISSUE_TEMPLATE/bug.md` |
| The approved bytes are the bytes sent          | the digest check in `create`                                                                                                       | a retyped draft; a body path on the command line                 |
| Whether labels are requested                   | `.permissions`, read in `create`                                                                                                   | a refusal parsed from `gh`                                       |
| Reports without a board                        | this table: the shipped verb names no board and calls no `gh project`                                                              | a project number in any shipped file                             |

New helper: **add a new helper.** Inventoried:
`skills/task/scripts/github/{add,move,set-field,detect-fields}.sh`. They are backend-filtered, so
absent on other backends, read the project's config through `_config.sh`, and exit 2 without one. An
override flag on them is the wrong-project path this plan closes. Two occurrences: the guide's URL
protocol, and `.github/ISSUE_TEMPLATE/bug.md`. It takes data only. `gh --jq` only, for
`jq_crlf_test.ts`.

Decided, and recorded because it departs from the ticket:

- **The shipped verb does not place cards.** Rejected: a `place` subcommand naming the maintainers'
  board. That board is private and holds other repositories' cards, its number would become
  permanent in public tags, the path could only ever run for maintainers, and no CI token can
  exercise it. The maintainers' workspace owns its board: its own addendum to this verb attaches and
  classifies through its own multi-repository scripts, with the reads back it already has.
  Elsewhere, the untracked sweep attaches the issue at the next landing.
- **The main session creates, not the product-owner.** A consumer's product-owner owns that
  project's backlog; one line cannot suspend its first action, backend detection and classification
  gate, a customised copy never receives it, and its tools take a bare number against the project's
  own repository. The ticket calls the wiring a design choice.

## Constitution check

I: the script names only the public repository. XI: the report leaves the project, which is where a
consumer's name could cross; FR-004 and FR-011 are the control, and the Risks say what remains.

## Surfaces

**Surfaces added or widened:** an outbound write to a public tracker under the user's account; a new
agent instruction surface; upstream titles as untrusted input to an agent; a public verb.

Files, `wc -l` now: `skills/specnaut/SKILL.md` 87, `agents/specnaut-guide.md` 167 (shrinks),
`skills/specnaut-facts/SKILL.md` 64, `root/AGENTS.md` 207, `src/domain/addendum_audit.ts` 283,
`tests/plugin/plugin_sync_test.ts` 455 (over target, may not grow), plus new `phases/issue.md` and
`scripts/bash/report-upstream.sh` (target 300), the plugin mirrors, `src/templates_bundle.ts`,
`templates/manifest.json` (its row is silent if missed), `scripts/smoke/smoke-agents.sh`, a mapped
smoke per `_surfaces.sh`, `scripts/smoke/smoke-task.sh`, `.github/ISSUE_TEMPLATE/bug.md`,
`scripts/gh-issues/list.ts`, `tests/scripts/bug_report_scrubber_test.ts`,
`harness_commands_test.ts`, `phase_addenda_test.ts`. `apps/specnaut-web/docs/llms.md` is another
half: its own commit.

## Risks

- A consumer's detail published. The scan catches patterns and local values; a project name in prose
  is caught by the model and the user reading. Publication cannot be recalled. Residual, accepted: a
  careless yes.
- A title that steers the agent. Bounded, not closed: FR-009 plus the harness's prompt on the
  script. Residual MEDIUM, accepted.
- The user's login is disclosed. Shown at the ask.
- Bash only. Windows runs it through Git Bash, as hooks do, and a body file is read by `gh.exe` from
  `~/.specnaut`. Watched in Windows CI.

## Audit findings

### Architecture

Fail on the first version, three HIGH. Accepted: the main session creates; the slug's two homes with
an equality test; the plain "script absent" row; permissions read before `create`; the blast radius
above. Rejected: `probe` and `place` for board access, since the shipped verb no longer touches a
board, which also removes the finding on proving board access and the idempotent-placement finding.

### Security

Fail on the first version, three HIGH. Accepted: the yes bound to a digest (FR-004, FR-006), the
deterministic scan (FR-011), titles as the carrier (FR-009), scrub before search (FR-012), the
closed grammar and no scope advice (FR-008, FR-013), the pinned host and id (FR-005), the retraction
text (FR-014), the script-built link (FR-016). Its finding on the board number is closed by not
naming one.

### Review round

Both review seats ran on the built branch. Accepted, in the code: `REFUSED storage` routed to the
link; quoted heredocs with a delimiter the model picks; a wider secret, hidden and addressing scan;
literals by kind, from every directory and remote segment; scans that fail closed; the login stored
and compared at `create`; an exclusive marker and `mktemp`; no `labels=` in the link, so FR-010's
rule has one place; unsent reports pruned after a day. The scans and the store are in
`_report_text.sh` and `_report_store.sh`, sourced by the script to keep each under its size target;
the header stays the one home of the list.

Departure from the review's wording, for the reason given: `Basic` needs a token-like value, as
`Bearer` does. The literal pattern refuses "basic functionality" with no override.

## Open questions

None. Decided by the seats and reported above.
