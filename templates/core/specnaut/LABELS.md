# Specflow semantic labels

Specflow ships a canonical set of generic, semantic labels that every
project should agree on. They are deliberately stack-agnostic — no
`frontend`, `backend`, `ios`, etc. Pick those per project and add them
on top of this baseline if you need them.

| Label         | Color     | Purpose                                                        |
|---------------|-----------|----------------------------------------------------------------|
| `bug`         | `#d73a4a` | Defect / regression (GitHub default — already present)         |
| `security`    | `#b60205` | Security-sensitive work (auth, secrets, RCE, supply chain)     |
| `refactor`    | `#0e8a16` | Internal cleanup with no behavior change                       |
| `docs`        | `#0075ca` | Documentation-only change                                      |
| `tech-debt`   | `#fbca04` | Known shortcut to repay later                                  |
| `dx`          | `#5319e7` | Developer experience (tooling, onboarding, ergonomics)         |
| `performance` | `#e99695` | Latency, throughput, or memory improvements                    |
| `dependency`  | `#cccccc` | Dependency bump or vendoring                                   |

## Bootstrapping the set

### GitHub backend

```bash
.specnaut/scripts/backlog/ensure-labels.sh
```

Idempotent — creates only missing labels, never edits or deletes
existing ones. Verifies that GitHub's default `bug` label is present and
warns if it is not. Run once after `specflow init` (or any time you want
to bring an existing repo into alignment).

### GitLab backend

```bash
.specnaut/scripts/backlog/ensure-labels.sh
```

Same shape as the GitHub helper. Uses `glab label create`.

### Local Markdown backend

There are no labels — the local backend tracks tags in task-file
frontmatter (`tags:` array). When in doubt, draw from the same vocabulary
above so projects that later migrate to a remote backend keep continuity.

## Conventions

- **Don't rename Specflow's labels.** The `product-owner` agent
  recognises them by name when grooming.
- **Add domain labels in addition** — `frontend`, `auth`, `billing` —
  but keep this base set stable.
- **`priority:*` and `size:*` labels are deprecated.** Specflow now
  writes those to native Project V2 fields (`Priority` / `Size`) when
  available — see `set-field.sh`. Existing label-only projects still
  work via the same fallback path.
