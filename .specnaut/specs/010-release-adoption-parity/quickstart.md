# Quickstart — Adoption-guide parity for release notes

How to reproduce #363 by hand and where the automated coverage lives.

## Reproduce the bug (unauthenticated → empty guide)

```bash
cd apps/specflow
# Simulate CI's unauthenticated context: clear gh auth from the env.
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR=/tmp/empty-gh \
  deno run --allow-read --allow-write --allow-run \
  scripts/gen-changelog.ts --from v1.12.0 --to v1.13.0 --out /tmp/notes-bug.md
grep -c '### Adoption guide' /tmp/notes-bug.md   # → 0  (silently missing; warnings on stderr)
```

## Fixed path (authenticated → guide present)

```bash
cd apps/specflow
# Local engineer is gh-authenticated; the guide appears.
deno run --allow-read --allow-write --allow-run \
  scripts/gen-changelog.ts --from v1.12.0 --to v1.13.0 --out /tmp/notes-ok.md
grep -c '### Adoption guide' /tmp/notes-ok.md     # → 1
```

## Strict mode (the CI guard)

```bash
cd apps/specflow
# Strict + unauthenticated ⇒ non-zero exit, no file written (build would fail
# before publish instead of shipping an incomplete body).
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR=/tmp/empty-gh \
  deno run --allow-read --allow-write --allow-run --allow-env \
  scripts/gen-changelog.ts --from v1.12.0 --to v1.13.0 --strict --out /tmp/notes-strict.md
echo "exit=$?"                                    # → exit=1
test -f /tmp/notes-strict.md && echo "WROTE (bug)" || echo "no file (correct)"
```

## How CI runs it after the fix (`.github/workflows/release.yml`)

```yaml
- name: Generate release notes
  env:
    GH_TOKEN: ${{ github.token }}
  run: deno run --allow-read --allow-write --allow-run --allow-env scripts/gen-changelog.ts --strict
```

`GH_TOKEN` makes `gh pr view` authenticated (root cause); `--strict` fails the build on any
retrieval failure before `softprops/action-gh-release` publishes.

## Automated coverage

```bash
cd apps/specflow
deno task test                              # full suite
deno test tests/scripts/gen_changelog_test.ts   # this feature's tests
```

| Contract / SC                            | Where                                                      |
| ---------------------------------------- | ---------------------------------------------------------- |
| C1 entries for all valid blocks (SC-001) | `gen_changelog_test.ts::assemble — all retrieved`          |
| C2 byte-parity (SC-002)                  | `gen_changelog_test.ts::adoption section golden`           |
| C3 strict halts on failure (SC-003/005)  | `gen_changelog_test.ts::strict exits on retrieval failure` |
| C4 v1.13.0 regression (SC-004)           | `gen_changelog_test.ts::v1.13.0 fixture count`             |
| C5 absence is quiet (SC-006)             | `gen_changelog_test.ts::absent + no-block ⇒ no failure`    |
| Outcome normalisation (FR-004)           | `gen_changelog_test.ts::fetch outcome failed≠absent`       |

The fake fetcher (`Map<number, PrBodyOutcome>`) keeps every test hermetic — no live `gh`, no
network.
