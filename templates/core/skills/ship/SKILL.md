---
name: ship
description: Take a built thing to production — compute and push a version tag, publish a release with categorized notes, or publish a release for a tag that already exists. Inspects repository state first and asks only when the intent is genuinely ambiguous. The versioning scheme is fixed at init time and recorded in `.specnaut/installed.lock`.
argument-hint: [tag|release|<version>] [--bump major|minor|patch] [--no-push]
when_to_use: |
  Trigger phrases that should route here:
  - "ship it", "ship this", "cut a release", "publish a release"
  - "tag a version", "create a release tag", "bump the version"
  - "release notes", "generate the changelog for the tag"
  - "publish v1.2.0", "release the tag we pushed yesterday"
  Do NOT route here for merging a feature branch — that is `/specnaut merge`.
---

# Ship skill

**Response style** — brevity, visual order, questions as selections, badge colours — follows the `response-style-contract` skill; read it, never restate it here.

Specnaut gives a project three skills, and they divide by what they own:

| Skill | Owns |
| :--- | :--- |
| `/board` | the backlog — what we might do, and what we are doing |
| `/specnaut` | the specification — what a thing is, and whether it is built right |
| **`/ship`** | **production — getting a built thing out the door** |

Shipping is not a specification concern. It has a different cadence, a
different risk profile — irreversible, outward-facing, it triggers live
pipelines — and a different audience. That is why it is its own verb rather
than a phase of the router that writes plans.

## The three paths

| | Path | What happens |
| :--- | :--- | :--- |
| **A** | **Tag only** | Compute and push the next tag. No release is published. |
| **B** | **Tag and release** | Tag, then generate notes and publish the release. |
| **C** | **Release an existing tag** | Publish a release for a tag that has none. No new tag. |

## Step 1 — inspect before acting

Never ask a question the repository can answer. Run these first:

```bash
git status --porcelain          # is the tree clean?
git fetch --tags --quiet        # so tag computation sees origin
git tag --list --sort=-v:refname | head -5
git log --oneline -1
```

Then determine, without asking:

- **Is the tree dirty?** If so, say what is uncommitted and stop. Do not
  stash, do not commit on the user's behalf, and do not tag a tree that does
  not match what will be built.
- **Does an unreleased tag exist?** A tag with no corresponding release is the
  strongest signal for path C, and it is the case a user most often means when
  they say "release" with no argument.

## Step 2 — resolve the intent

Resolve from the argument when it is unambiguous. Ask only when it is not.

| Input | Path |
| :--- | :--- |
| `/ship tag` | A |
| `/ship release` with an unreleased tag present | C, on that tag |
| `/ship release` with no unreleased tag | B |
| `/ship <version>` where the tag does not exist | B, at that version |
| `/ship <version>` where the tag exists and has no release | C |
| `/ship` with no argument | see below |

**`/ship` with no argument, and an unreleased tag exists** → path C is the
answer; state that you are publishing the release for that tag and proceed.
Naming what you resolved is not the same as asking.

**`/ship` with no argument and nothing to disambiguate it** → ask once, as a
selection, per the response-style contract:

> **What would you like to do?**
> - **Tag only** — create and push a new tag, no release
> - **Tag and release** — tag and publish the release immediately
> - **Release an existing tag** — publish a release for a tag that has none

## Step 3 — execute

Read the phase document for the path and follow it end to end. Do not
reimplement what the bundled scripts already do.

| Path | Read | Drives |
| :--- | :--- | :--- |
| A | `phases/tag.md` | `.specnaut/scripts/release/tag.sh` |
| B | `phases/tag.md`, then `phases/release.md` | `tag.sh`, then `release.sh` |
| C | `phases/release.md` | `release.sh` |

The scripts live at `.specnaut/scripts/release/` — a project-relative path that
does not change with the harness. The versioning scheme (SemVer or date-based)
is baked in at `specnaut init`; the scripts read it, you do not choose it.

## Step 4 — confirm before the irreversible act

**A tag push and a release publish are irreversible and outward-facing.**
Pushing a tag can trigger a live pipeline; publishing a release can trigger a
deploy. Before either:

1. Show the computed tag, the target remote, and the commit subject.
2. Ask once, as a concrete proposal — **"I'm about to push `<tag>` to
   `<remote>` — OK?"** — never as an open question.
3. On confirmation, proceed and print the resulting URL.

`--no-push` creates the tag locally and skips the push, and needs no prompt.

## What this skill does not do

- **It does not deploy.** In the recommended model a deploy is triggered by a
  *published release*, not by a tag push and not by a branch push. See
  `phases/release.md` → "From release to production".
- **It does not edit version fields** in `package.json`, `Cargo.toml`,
  `pyproject.toml` or any manifest. The git tag **is** the version.
- **It does not run tests or quality gates.** Run them before shipping; that
  contract is project-specific and lives outside this skill.
- **It does not merge anything.** Landing a feature branch is
  `/specnaut merge`.
