# The helper-script gate

`resume`, `groom`, the backlog verbs and `audit` load this doc before the first script under
`.specnaut/scripts/` runs. `review` and `merge` run their own gate step (`phases/review.md` step 1,
`phases/merge.md` step 0, whose outcomes are § Merge's step 0 outcomes); every verb that runs a
gate reads § The config verdicts.

## Resolving the verifier

Every block that runs the verifier runs this one first, in the same shell, and then calls `"$sn"
verify-scripts`, never the bare name: the PATH can name a folder of the tree, where a branch puts a
`specnaut` of its own. Before git runs, it judges the PATH itself, every command being looked up on
it: an entry that is empty or relative (searched from the working folder), holds a `.` or `..`, or
sits in the tree (the nearest folder holding a `.git`) can supply any command, and the first one is
refused by name. An entry sits in the tree when it is spelled there, whatever a link of the tree
points at, or when the links on it lead there. Then it sets `sn` to the physical file `specnaut` resolves to, following each
link one hop at a time (40 at most), and refuses a name that is not an absolute path, or one whose
folder, or any link on the way to it, sits in this repository. `-ef` compares device and inode, so
neither case, a drive-letter spelling nor a `<repo>-x` sibling passes for the repository. It runs
in bash and in zsh alike, in the session's own shell: it reaches `cd`, `pwd` and `command` through
`\builtin`, and clears zsh's `chpwd` hooks inside each `$(…)` that changes folder, so no function,
alias or hook of that shell stands in for them. `land-feature.sh` holds the same rule as
`refuse_unsafe_path` and `resolve_specnaut`, in `_verifier.sh` beside it; the Claude Code review
hooks drop such entries instead (`_clean-path.sh`), and every Claude Code hook Specnaut runs with
bash starts under `bash -p`, resolved on the PATH they keep as `specnaut` is (`run-hook.sh`): no
`BASH_ENV` and no exported function runs before its first line.

The rule judges where a command is found, not what ran before it was asked. Out of its reach: what
the session's shell loaded when it started (its rc files, `BASH_ENV`), and a function of that shell
named `builtin` or `[`; the dynamic loader's `LD_LIBRARY_PATH`, `LD_PRELOAD` and `DYLD_*`, read
before any shell runs a line, where an empty entry is the working folder; and a version manager's
shim, found outside the tree, which picks the program it runs from a file in the working folder. A
session that carries one of them is not protected from it by this block, the landing or the hooks.
Codex hook commands still start bash from the PATH as given.

<!-- script-gate: resolve-verifier -->
```bash
sn=""; why=""; n=0; p=""; top=""; d=$(\builtin pwd -P); rest=${PATH-}:
while [ -z "$top" ]; do [ -e "$d/.git" ] && top=${d:-/}; [ -n "$d" ] || break; d=${d%/*}; done
[ -n "$top" ] || why="has no repository to be judged outside of"
while [ -z "$why" ] && [ -n "$rest" ]; do
  e=${rest%%:*}; rest=${rest#*:}; a=$e
  case $e in "") why="is empty" ;; /*) ;; *) why="is not an absolute path" ;; esac
  case /$e/ in */./* | */../*) [ -n "$why" ] || why="has a . or .. component" ;; esac
  while [ -z "$why" ] && [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
  [ -n "$why" ] || ! [ "$a" -ef "$top" ] || why="is inside the repository"; a=$e
  while [ -z "$why" ] && ! [ -e "$a" ] && ! [ -L "$a" ]; do a=${a%/*}; a=${a:-/}; done
  [ -n "$why" ] || a=$(\builtin unset -f chpwd 2>/dev/null; \builtin unset chpwd_functions
    \builtin cd -P -- "$a" 2>/dev/null && \builtin pwd) || why="names a folder that cannot be entered"
  while [ -z "$why" ] && [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
  [ -n "$why" ] || ! [ "$a" -ef "$top" ] || why="is inside the repository"
  [ -z "$why" ] || { p="PATH entry '$e'"; why="$why - start the session from a shell without that entry"; }
done
if [ -z "$why" ]; then
  p=$(\builtin command -v specnaut); top=$(git rev-parse --show-toplevel)
  case $p in /*) ;; "") why="is not on the PATH" ;; *) why="is not an absolute path" ;; esac
  [ -n "$why" ] || [ -n "$top" ] || why="has no repository to be judged outside of"
fi
while [ -z "$why" ]; do
  d=$(\builtin unset -f chpwd 2>/dev/null; \builtin unset chpwd_functions
    \builtin cd -P -- "${p%/*}/" && \builtin pwd) || { why="names a folder that cannot be entered"; break; }
  p="$d/${p##*/}"; a=$d
  while [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
  if [ "$a" -ef "$top" ]; then why="is inside the repository"; break; fi
  if ! [ -L "$p" ]; then sn=$p; break; fi
  n=$((n + 1)); if [ "$n" -gt 40 ]; then why="links more than 40 times"; break; fi
  t=$(readlink "$p") || { why="is a link that cannot be read"; break; }
  case $t in /*) p=$t ;; *) p="$d/$t" ;; esac
done
[ -n "$sn" ] || echo "VERIFIER REFUSED: ${p:-specnaut} $why"
```

A `VERIFIER REFUSED: <path> <why>` line, or `VERIFIER REFUSED: PATH entry '<entry>' <why>`, leaves
`sn` empty, and the call after it fails: stop and say so, quoting the line. The verifier is an installed release: one that runs this checkout's own
source is the branch's.

## The gate

Run § Resolving the verifier's block, then this one, as written and in that same shell, from the
project's root, before the first script of the tree, and again after any `git switch`, `git
rebase` or commit the verb makes:

<!-- script-gate: verify-scripts -->
```bash
out=$("$sn" verify-scripts); rc=$?; printf '%s\n' "$out"
base=$(printf '%s\n' "$out" | sed -n 's/^BASE \([0-9a-f]\{40,64\}\)$/\1/p')
last=$(printf '%s\n' "$out" | tail -n 1)
names=$(printf '%s\n' "$out" | sed -n 's/^NAMES_FILE //p'); [ -z "$names" ] || rm -f "$names"
if [ "$rc" -eq 0 ] && [ -n "$base" ] && [ "$last" = "VERDICT scripts trusted" ]; then
  echo "SCRIPTS TRUSTED"
else
  echo "SCRIPTS NOT RUN: verify-scripts exit $rc"
fi
```

`SCRIPTS TRUSTED` is the one outcome under which the verb runs a script of the tree. Any other
runs none in this run: report the `SCRIPTS NOT RUN` line and each `UNTRUSTED` line, and stop. No
`BASE` line (exit 2 or 3, a `VERIFIER REFUSED` line, or no `specnaut` on the PATH) means the base
or the verifier is missing or refused: say which. No verb but `merge` passes the verifier a flag. Never fall back to a script of the tree, nor to a hand-run of what it does.
The `BASE` sha is the base for any range the verb passes a script.

## Merge's step 0 outcomes

`phases/merge.md` step 0 reads each of its runs against this list. After a yes, every later run
passes the digest it covers: `--approved-scripts <SCRIPTS_DIGEST>` for the scripts' yes,
`--approved-instructions <INSTRUCTIONS_DIGEST>` for the instructions' yes, and no flag without a
yes. The binary compares them and prints an `APPROVAL <class> holds|moved <digest>` line per
flag; the phase never compares digests itself. The first case that matches decides, on every run:

- **Trusted** — exit 0, a full `BASE` sha, and the last line `VERDICT scripts trusted`: go on.
- **Approved** — the run passed a digest, exit 0, a full `BASE` sha, and an `APPROVAL <class>
  holds` line for each digest passed: go on under the yes.
- **Moved** — an `APPROVAL <class> moved` line, whatever the exit: that class's yes is void, the
  tree is not the one the user said yes to. Run step 0 again without that flag and read that run
  from the top: a class it finds untrusted asks its question again.
- **Held** — the run passed a digest, exit 1, and every `APPROVAL` line holds: a class with no
  flag is not trusted. Read the run as one without flags, each class whose line holds counted as
  trusted: the scripts by the cases below, the instructions by § The instructions verdict, whose
  question is asked before step 3.
- **Exit 1, read only with a `BASE` line, at least one `UNTRUSTED` line and the last line
  `VERDICT scripts untrusted`** — otherwise it is *anything else*, below.
  - An `UNTRUSTED` path outside `.specnaut/scripts/` (`local <base> ahead of origin`, the lock at
    base): **stop on the branch** and say so. Never asked: no yes makes it hold.
  - An `UNTRUSTED` reason under `.specnaut/scripts/` that no yes can hold: **stop on the branch**
    and say why: the digest names no bytes that would run, so the binary answers any yes with
    `APPROVAL scripts moved`, and `land-feature.sh` stops on that line too. Never asked. A yes
    holds only these reasons: `differs from base`, `not on base`, `first install: no base copy`,
    `on base, missing from the tree`, `name differs in case from base`, `line endings differ: the
    same text but for a CR before LF; a diff can be empty`, `behind base: rebase` and `not a
    regular file on base`. No yes holds any other, among them `a link`, `not a regular file`,
    `hard-linked`, `a submodule on base`, an unreadable entry's and a stopped walk's. Compare the
    whole reason the line prints, never its start: `not a regular file` is never held, though `not
    a regular file on base` begins with it.
  - Every reason `behind base: rebase` — `git -c core.hooksPath=/dev/null rebase
    refs/remotes/origin/<BASE_BRANCH>`, then step 0 again at once. Not a question: the branch only
    lags the base.
  - Any other — this run's merge mode is `manual`, whatever `phases/auto-chain.md` read. Stop on
    the branch, name each `UNTRUSTED` path and its reason, and ask once: *"This branch changes
    these helper scripts. Yes lands these scripts and runs them to land."* The yes covers that
    run's `SCRIPTS_DIGEST` and its `UNTRUSTED` paths and nothing else: a later run with another
    digest, or an `UNTRUSTED` path outside that set, asks again. Under it the rest of the merge
    runs, `land-feature.sh` and `phases/merge-close.md` included; anything else stays on the
    branch, nothing landed. Every later run passes that digest as `--approved-scripts`.
- **Anything else** — exit 3, a `VERIFIER REFUSED` line, no `specnaut` on the PATH, output without
  those parts: stop on the branch and say so. Nothing lands.

## The config verdicts

Before the gate's `VERDICT scripts` line, the verifier prints one line per config input a branch
controls: `VERDICT <class> trusted`, or `VERDICT <class> untrusted <path> <reason>`. Trusted means
the work tree holds the value the base branch's tip holds, so reading the tree reads the base.
A verb that ran a gate reads an input only under that gate's trusted line. An untrusted line, or
none, means the tree's value is never read, and the row below applies:

| Class | Read by | Not trusted |
| :--- | :--- | :--- |
| `workflow` | `merge-mode.sh`: `phases/auto-chain.md`, `phases/merge.md` step 0 | the mode is `manual`, the reading that asks |
| `size-limits` | `size-ratchet.sh`: `phases/review-seats.md`, `phases/quality-gates.md`; `specnaut scan`: `phases/audit.md` | not run: report `NOT RUN: <the line>`, never a pass; `merge` asks (its **The full tier**) |
| `boundaries` | `boundary-check.sh`: `phases/review-seats.md`, `phases/quality-gates.md`, `phases/audit.md` | as `size-limits` |
| `backlog-config` | every backlog script, and remote mode: `backlog.md`, `groom.md`, `resume.md`, `phases/auto-chain.md`, `phases/merge.md` step 5 | no backlog script runs: stop and say so (at merge the landing stands); the mode is `manual`; remote mode is on if either copy turns it on, and then nothing lands (`phases/auto-chain.md`) |
| `linked-issue` | `.specnaut/feature.json`'s link: `resume.md`, `phases/plan-reentry.md`, `phases/merge.md` step 5 (whose item `phases/merge-close.md` takes) | the link is not read; `phases/merge.md` step 5 names its one exception |
| `gates` | `run-gate.sh`: `phases/merge.md` **The full tier**, `phases/review-seats.md`, `phases/quality-gates.md` | `merge` asks; the review's fast tier is skipped |
| `instructions` | the session itself: `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` every turn, and `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `CLAUDE.local.md` in any folder below the root, `docs/constitution.md` and a phase's project additions as it runs; and the harness: `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/commands/`, `.claude/rules/`, `.claude/output-styles/`, `.claude/settings.json`, `.mcp.json`, `.codex/`, `.agents/`, `.specnaut/hooks/`, with `.gitattributes` (in any folder) and `.lfsconfig`, judged in the work tree and at HEAD; `AGENTS.override.md`, `CLAUDE.local.md` and `.claude/settings.local.json` judged as committed at HEAD, as are, for a project in a subfolder, `AGENTS.md` and `CLAUDE.md` in each folder above it, named `../AGENTS.md`, every file a judged `CLAUDE.md` imports with `@path`, and every file a judged hook (a settings file's, or one a skill's, an agent's or a slash command's frontmatter declares), a skill's or a slash command's `` !`…` `` span, an MCP server or a Codex entry runs, and each program a command names by name alone in each folder a judged config puts on `PATH` (an `env` key `PATH`, read in any letter case and in any object, a word `PATH=…`): any word of a command without a slash, so the one a wrapper runs too (`timeout 30 lint`, `bash -c 'lint'`), bare or with a Windows extension (`lint.cmd`), each followed at HEAD and at the tip. A `PATH` folder that holds a variable past its start (`./tools/$OS/bin`), and a path with `..` after a variable (`tools/$OS/../run.sh`), name their source as not fully read. Not read: the manifest of a runner other than `npm`, `pnpm`, `yarn`, `bun` (`package.json`), `make`, `gmake` (a Makefile), `just` (a justfile) and `deno` (`deno.json`); the folders a shell puts on `PATH` before the session starts (`.envrc`'s `PATH_add`, mise's configuration); a folder a command names (`node server/`); what a file a command runs itself sources or runs; a path whose file name is a variable alone (`scripts/$NAME`) or that names no folder before a variable (`$NAME.sh`), where one built around a variable elsewhere (`scripts/$NAME.sh`) is matched against every file it may name | the read already happened: `phases/merge.md` step 0 makes the mode `manual` and asks, as **The instructions verdict** below says; one line per path |

`backlog-config` judges every line of `.specnaut/backlog-config.yml` but the columns grooming
writes (`intake_column`, `ready_column`), each held to the one quoted value grooming writes: the
tracker's address on any backend, and the `remote:` block. `linked-issue` judges the link as its
`sed` readers take it, raw: one `"linked_issue"` key, whose value is `null` or a whole number from
1, compared as written; a file its readers could read two ways is refused.

### The instructions verdict

`phases/merge.md` step 0 acts on it. Unless the last run printed `VERDICT instructions trusted`, or
only `instructions` lines reading `behind base: rebase` (rebased as step 0 rebases a config line),
the merge mode is `manual`: a missing `instructions` line is an untrusted one. Show each named path
as it lands: `git diff --text --no-textconv --no-ext-diff --no-color <BASE_TIP> HEAD -- <path>` (a
file the base lacks, in full). A `work tree differs from HEAD` reason means the session read other
bytes than those that land, whatever `git status` shows; for such a path HEAD lacks, show the work
tree's file and say it does not land. A `line endings differ` reason, whose diff can be empty, is
shown as its reason says: the same text, a CR before LF on one side only. A `holds invisible
characters` reason names each code point and its line: say so with the diff, which does not show
them. A `differs from the copy Specnaut ships` reason names a skill Specnaut ships whose bytes are
not the shipped copy, even where the base holds the same edit: show `specnaut diff <path>`, which
compares it with that copy. Then ask once, as the one question before step 3: *"This branch changes
the instructions, skills, hooks or settings this session's harness loads. Yes lands them."* A no
stops on the branch. The yes covers that run's `INSTRUCTIONS_DIGEST` (the files as HEAD commits them
and the reasons shown) and nothing else: a later run with another digest asks again, even naming the
same paths, or with a new reason, and a run with no such line asks. Every later run of step 0
passes it as `--approved-instructions`, and its `APPROVAL instructions holds` line answers this
question: it is not asked again. Step 3 passes that digest to `land-feature.sh` as
`--instructions-digest`, which judges HEAD again and refuses (13) any other.
The session read `AGENTS.md` before step 0 ran: this stop is the control, not undoing that read.
