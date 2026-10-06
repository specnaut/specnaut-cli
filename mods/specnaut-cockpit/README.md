# Specnaut Cockpit

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) for developers who work
with Specnaut in Claude Code. It shows how much of your usage limits is spent, keeps a local history
of what your work costs, follows the `/specnaut` chain as the autopilot runs it, and stops the
autopilot cleanly before a limit would cut a phase off halfway.

## What it shows

A band above the prompt, sized to your terminal:

```text
5h 82% ↻2h10 · 7d 31% ↻3d4h · ctx 48% · $3.12 · ▸ plan ✓ tasks ✓ implement ● review ○ merge ○
```

- **5h / 7d**: the 5-hour and weekly usage windows, with the time until each resets. Yellow from the
  warning threshold, red from the hold threshold.
- **ctx**: how full the context window is.
- **$**: what this session has cost so far.
- **▸**: where the Specnaut chain is: done ✓, in progress ●, still to come ○.

A narrow terminal drops the reset times and the chain's detail first. The windows stay.

A toast announces each window once when it crosses the warning threshold, and once more at the hold
threshold. It does not repeat on every turn.

`/cockpit` opens a pane with the limits, this session, the last seven days (cost and the 5-hour peak
per day) and the branches that cost the most. `/cockpit hide` and `/cockpit show` toggle the band
for the session.

## The quota hold

Since v5, the chain runs on autopilot after the plan: implement, review, merge, push. A usage limit
reached in the middle of that run can leave a merge without its push, or a review whose findings
were never applied.

When a usage window is at or above the hold threshold (90% by default), the cockpit refuses the call
that starts `implement`, `review` or `merge`. Refusing that call stops the chain at the boundary
between two phases. The agent then tells you the chain is paused, with the figures, and that
`/specnaut <phase>` resumes it after the reset. If you tell it to continue anyway, it continues, and
the same window does not hold it again.

The hold is the only thing the cockpit ever refuses. It touches no other tool and no other skill,
and if one of its hooks fails, the call goes through.

## Settings

Set these in `/config` or with `/plugin configure specnaut-cockpit@specnaut-marketplace`:

| Option    | Default | Effect                                                              |
| --------- | ------- | ------------------------------------------------------------------- |
| `hold_at` | 90      | Window percentage that holds the autopilot. 100 turns the hold off. |
| `warn_at` | 80      | Window percentage shown in yellow and announced.                    |
| `band`    | on      | Off keeps only `/cockpit` and the hold.                             |

## Where it works

The band, the pane and the toasts appear in Claude Code in a terminal and in the Code tab of the
desktop app. In the IDE extension's chat panel and in `claude -p`, nothing is drawn, but the hold
still applies. Rate-limit windows appear on plans that have them. With an API key, the band shows
context, cost and the chain.

## Privacy

The history (cost and peaks per day, cost per branch, kept for 90 days) is stored in the mod's own
store on your machine. Nothing is sent anywhere. The mod reads the current branch with
`git rev-parse`, and that is the only process it starts.

## Install

```text
/plugin marketplace add specnaut/specnaut-marketplace
/plugin install specnaut-cockpit@specnaut-marketplace
```

Projects that `specnaut init` scaffolds for Claude Code declare the cockpit in
`.claude/settings.json`, so Claude Code offers to install it when you trust the project. Requires
Claude Code v2.1.287 or later.

## Development

The logic lives in `hooks/core/`, as pure TypeScript with no engine imports. It is tested by
`deno test tests/cockpit/` in the specnaut-cli repository. `hooks/register.tsx` connects it to
Claude Code, and `tests/*.test.tsx` checks that connection:

```bash
claude plugin validate mods/specnaut-cockpit
claude plugin test mods/specnaut-cockpit
claude --plugin-dir mods/specnaut-cockpit   # try it in a session
```
