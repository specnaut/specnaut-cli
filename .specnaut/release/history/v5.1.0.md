**The Specnaut Cockpit, for developers who work in Claude Code.** A Claude Code mod that puts your
usage limits in front of you: the 5-hour and weekly windows with the time until each resets, the
context fill, the session's cost, and the `/specnaut` chain's progress, in a band above the prompt.
`/cockpit` opens seven days of history per day and per branch, kept on your machine.

**The autopilot now stops cleanly before a limit cuts it off.** When a usage window reaches 90%, the
chain halts at the next phase boundary — before `implement`, `review` or `merge` — instead of being
cut off halfway, and `/specnaut <phase>` resumes after the reset. Projects scaffolded for Claude
Code offer to install the cockpit when you trust them; `specnaut upgrade` adds the same declaration
and says so. Set `"specnaut-cockpit@specnaut-marketplace": false` to decline.

**The Claude Code marketplace installs again.** The published catalog did not match Claude Code's
format, so `/plugin install` installed an empty plugin. Use
`/plugin marketplace add specnaut/specnaut-marketplace` then
`/plugin install specnaut-plugin@specnaut-marketplace`.
