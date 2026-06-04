# Quickstart: Gate-aware clarify phase

## The `specflow gate` command

```bash
# Is remote mode on for this project?
specflow gate status            # exit 0 + {"enabled":true,...}  |  exit 2 off  |  exit 5 not linked

# Raise a decision gate and block for a remote answer (prints the answer JSON on resolve)
specflow gate raise \
  --type decision \
  --title "Which auth model for the CLI?" \
  --payload '{"question":"Device flow or token?","options":[{"id":"A","label":"Device flow"},{"id":"B","label":"Pasted token"}],"context":"spec 003 FR-003"}'
# → {"choiceId":"A"}   (exit 0)   |   exit 3 timeout · 4 cancelled · 5 no-login

# Free-form clarification
specflow gate raise --type clarification --title "Name the flag" \
  --payload '{"question":"What env var name?"}'      # → {"text":"SPECFLOW_REMOTE"}

specflow gate cancel gate_7Kf3Qx9
```

Headless: `SPECFLOW_REMOTE=1` + a logged-in project (or `SPECFLOW_CLOUD_TOKEN`) makes `raise` block
until the gate is resolved from a phone, then emit the answer for the calling phase to consume.

## Tests (no network)

```bash
deno test tests/cli/gate_parser_test.ts tests/integration/gate_command_test.ts
deno task check && deno lint && deno fmt --check && deno task test
```

The integration test drives `specflow gate raise` through `main.ts` with an injected fetch + clock
stub (a resolving backend) and asserts: the answer JSON on stdout, exit 0; the
timeout/cancel/no-creds exit codes; and that no Cloud-internal identifier appears in stdout (§ I).

## Gate-aware clarify

With remote mode on, `/specflow clarify` raises each accepted question as a gate (MC → `decision`,
free-form → `clarification`), suspends, and resumes when answered — writing the clarification into
the spec exactly as the local loop would. With remote mode off, the interactive local loop runs
unchanged.
