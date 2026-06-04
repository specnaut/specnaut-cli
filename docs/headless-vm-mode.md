# Headless VM operating mode

Run the full Specflow chain **unattended** on a remote VM — no operator at the terminal. Every human
checkpoint becomes a **gate** you resolve from anywhere (e.g. your phone), and the run resumes
automatically when you answer. This composes the remote-control gate features:

- the gate client + remote-mode switch ([#357]),
- the `specflow gate` command + gate-aware **clarify** checkpoint ([#358]),
- the gate-aware **plan** and **merge** approval checkpoints ([#359], this feature).

> Requires Specflow Cloud. The CLI speaks only the public `/api/v1` gate contract
> (`docs/api/gates.md`); see that file for the wire format.

## 1. Enable remote mode

Remote mode is **off by default** — a normal local run is unchanged. Turn it on per-run or
per-project:

```bash
# Per run (headless / CI friendly — no file edits):
export SPECFLOW_REMOTE=1

# Or persist it in the project's .specflow/backlog-config.yml:
#   remote:
#     enabled: true
#     await_timeout_s: 1800   # how long a gate waits for you (default 1800)
#     poll_interval_s: 5      # base poll cadence (default 5)
```

`SPECFLOW_REMOTE` (`1|true|on` / `0|false|off`) overrides the file; unset defers to the file; the
default is off.

## 2. Authenticate the VM

The VM needs a Cloud credential so gates can be opened against your project:

```bash
specflow cloud login          # interactive device flow (one-time, stores a refresh token)
# — or, fully headless / CI:
export SPECFLOW_CLOUD_TOKEN=<a Cloud API token>
```

Sanity check: `specflow gate status` exits `0` when remote mode is on and the project is
Cloud-linked (exit `2` = remote off, `5` = not linked / not logged in).

## 3. Launch the run unattended

Drive the chain with either of the standard headless entry points — no Specflow-specific runner is
needed:

```bash
# One-shot, non-interactive:
claude -p "/specflow specify \"<feature description>\""

# Or goal-directed until an end state (re-takes turns on its own):
claude -p "/goal the feature ships and deno task test exits 0, or stop after 30 turns"
```

As the chain runs, each checkpoint opens a gate instead of prompting the terminal:

| Checkpoint                         | Gate type                    | You answer                              |
| ---------------------------------- | ---------------------------- | --------------------------------------- |
| Clarify (`[NEEDS CLARIFICATION]`)  | `clarification` / `decision` | the clarification text / a choice       |
| Plan approval (before `tasks`)     | `plan_approval`              | `approve` / `reject` (+ note to revise) |
| Pre-merge STOP #2 (before `merge`) | `merge_approval`             | `approve` / `reject` (+ note)           |

## 4. Resolve gates remotely

Open gates surface on the Cloud project (and, once [#18] ships, as a phone push). Answer one and the
waiting VM observes the resolution and continues — clarify writes the answer into the spec and
resumes; an approved plan/merge gate resumes into the next phase; a **rejected** approval halts the
run cleanly and reports your note (treat a reject-with-note as "revise and re-run" — the chain does
not auto-loop).

A gate that is never answered ends at the configured `await_timeout_s` with a distinct _unresolved_
outcome; the checkpoint halts rather than proceeding. **A STOP never auto-approves.**

## 5. Fallback when prerequisites are unmet

If remote mode is on but the VM isn't logged in (or the project isn't linked), each checkpoint
reports that `specflow cloud login` is needed and falls back to the local prompt — it never hangs
silently. With remote mode off, every checkpoint keeps its normal local behaviour.

## End-to-end

```
specify → clarify (gate) → plan → plan_approval (gate) → tasks → analyze →
implement → review → merge_approval (gate) → merge → done
```

With remote mode on and every gate resolved from your phone, that whole sequence runs with **zero
terminal interaction**.

[#357]: https://github.com/mkrlabs/specflow/issues/357
[#358]: https://github.com/mkrlabs/specflow/issues/358
[#359]: https://github.com/mkrlabs/specflow/issues/359
[#18]: https://github.com/mkrlabs/specflow-cloud/issues/18
