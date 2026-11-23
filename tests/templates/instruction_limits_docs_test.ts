import { assert, assertEquals } from "@std/assert";
import { flat, phase } from "./task_docs.ts";
import { RUNNERS } from "../../src/domain/command_runners.ts";

/**
 * What the instruction class does not read is stated in its row of `phases/script-gate.md`'s class
 * table, so a user knows which change a trusted verdict does not cover. Each limit is pinned on the
 * row as the bundle ships it, against the code that sets it where the code holds a list.
 */

function instructionsRow(): string {
  const row = phase("script-gate").content.split("\n").find((l) =>
    l.startsWith("| `instructions` |")
  );
  assert(row !== undefined, "script-gate.md has no `instructions` row");
  return flat(row);
}

/** The row's stated limits: what follows `Not read:`, up to the cell's end. */
function notRead(): string {
  const row = instructionsRow();
  const start = row.indexOf("Not read: ");
  assert(start >= 0, "the `instructions` row states no limit");
  return row.slice(start, row.indexOf(" | ", start));
}

/**
 * The runners the row names: each code span of its runner limit, up to the `;` that ends it, the
 * manifests in parentheses aside.
 */
function runnersNamed(limits: string): string[] {
  const lead = "the manifest of a runner other than ";
  const start = limits.indexOf(lead);
  assert(start >= 0, limits);
  const clause = limits.slice(start + lead.length, limits.indexOf(";", start));
  return [...clause.replace(/\([^)]*\)/g, "").matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
}

Deno.test("the row names exactly the runners whose manifest is read, and says no other's is", () => {
  assertEquals(runnersNamed(notRead()), [...RUNNERS.keys()].sort());
});

Deno.test("the row names the commands a skill, an agent or a slash command holds", () => {
  const row = instructionsRow();
  assert(row.includes("one a skill's, an agent's or a slash command's frontmatter declares"), row);
  assert(row.includes("a skill's or a slash command's `` !`…` `` span"), row);
  assert(row.includes("span or ```` ```! ```` block (an agent's file runs neither)"), row);
  assert(row.includes("or a skill's or a slash command's `allowed-tools` grants"), row);
  assert(
    row.includes("nested in one read as one of its own (a `$(…)`, a backquote, `bash -c"),
    row,
  );
});

Deno.test("the row names the programs on a judged PATH, and the PATH a shell builds as a limit", () => {
  const row = instructionsRow();
  assert(row.includes("each program a command names by name alone in each folder a judged"), row);
  assert(row.includes("so the one a wrapper runs too (`timeout 30 lint`, `bash -c 'lint'`)"), row);
  assert(row.includes("bare or with a Windows extension (`lint.cmd`)"), row);
  assert(row.includes("`PATH` folder that holds any expansion but `$PATH` and that variable"), row);
  assert(row.includes("(`$T/bin`, `${X:+…}`, `$(…)`) or a variable past its start"), row);
  assert(row.includes("(`./tools/$OS/bin`) under a key or a word spelled `PATH`"), row);
  assert(row.includes("as is an empty element (`:tools`, `tools::$PATH`) but for the"), row);
  assert(row.includes("a key `path` in any letter case of an `env` object or of Codex's"), row);
  assert(
    row.includes("`$CLAUDE_PROJECT_DIR` or `${CLAUDE_PROJECT_DIR}`, alone or before a `/`"),
    row,
  );
  assert(row.includes("while no judged source spells that name another way"), row);
  assert(row.includes("or binds a variable through `eval` or an expansion"), row);
  assert(row.includes("a path with `..` after a variable (`tools/$OS/../run.sh`)"), row);
  const limits = notRead();
  assert(limits.includes("such a folder under another spelling (a key `path`"), limits);
  assert(limits.includes("the folders a shell puts on `PATH` before the session starts"), limits);
  assert(limits.includes("`.envrc`'s `PATH_add`, mise's configuration"), limits);
});

Deno.test("the row names each PowerShell PATH form it reads, and each it does not read whole", () => {
  const row = instructionsRow();
  assert(row.includes("its `=` or `+=` glued to the value or not (glued to `$env:Path`, a"), row);
  assert(
    row.includes("shell's split cuts the value short, and it is not read whole), and a list"),
    row,
  );
  assert(
    row.includes("not read whole when an argument follows it, which `pwsh -c` joins to it"),
    row,
  );
  assert(row.includes("(`[Environment]::SetEnvironmentVariable('Path', …)`)"), row);
  assert(row.includes("through a `(…)` (`(Resolve-Path tools).Path`, `(Join-Path $PWD"), row);
  assert(row.includes("or a list holding anything but quoted strings and `$env:Path`"), row);
  assert(row.includes("quoted strings and `$env:Path` joined at a `;` (`$env:Path += ';'"), row);
  assert(row.includes("a pipeline (`|`) or a call (`&`), parts joined other than at a `;`"), row);
  assert(row.includes("or by another operator (`-replace`, `-f`)"), row);
  assert(row.includes('a variable other than `$env:Path` (`"$t;$env:Path"`)'), row);
  assert(row.includes("a typographic quote (`’`, `”`), no item before the line's end"), row);
  assert(row.includes("a string PowerShell reads otherwise than its words do (`'to''ols'`"), row);
  assert(row.includes("or not ended by its `-join ';'`"), row);
  const limits = notRead();
  assert(row.includes("assignment spelled across quotes a shell joins (`'$env:Path'' = …'`)"), row);
  assert(row.includes("is read from its words, its value held to the same rules"), row);
  assert(limits.includes("a path built at run time for `cp`, `mv`, `cd` or `pushd`"), limits);
  assert(limits.includes("reflection through none of those primitives"), limits);
});

Deno.test("the row names the PowerShell forms that set PATH no value is read from", () => {
  const row = instructionsRow();
  assert(
    row.includes("names the `env:` drive (`Set-Item env:Path …`, `gci env:`, a wildcard"),
    row,
  );
  assert(row.includes("or the `Environment` provider, makes a drive (`New-PSDrive`, `ndr`"), row);
  assert(row.includes("hands an item cmdlet (`Set-Item`, `New-Item`, `Set-Content`"), row);
  assert(row.includes("a path other than a plain word or string of letters, digits and"), row);
  assert(row.includes("`si @a`, a variable, a `(…)`, a backtick, a wildcard, a `Path` the"), row);
  assert(row.includes("location decides), or runs one after a `|`"), row);
  assert(row.includes("`&` or `.` before a `(`, a quote or a `$`"), row);
  assert(row.includes("one inside a quoted string a nested command runs ends its value"), row);
  assert(row.includes("assigns `$env:Path` in a list or with `??=`"), row);
  assert(row.includes("builds code or a member at run time (`Invoke-Expression`"), row);
  assert(row.includes("hands `pwsh` or `powershell` an encoded command"), row);
  assert(row.includes("writes what the next session inherits (`setx`, the registry's"), row);
  assert(row.includes("as written and as PowerShell's tokenizer reads it, where a `PATH`"), row);
  assert(row.includes("spelled through a backtick, a comment or a line's join"), row);
});

Deno.test("the row states what a command's targets leave unread", () => {
  const limits = notRead();
  assert(limits.includes("a folder a command names (`node server/`)"), limits);
  assert(limits.includes("what a file a command runs itself sources or runs"), limits);
  assert(limits.includes("a path whose file name is a variable alone (`scripts/$NAME`)"), limits);
  assert(limits.includes("or that names no folder before a variable (`$NAME.sh`)"), limits);
});

Deno.test("the row says how each harness reads a `$` in a value that sets the environment", () => {
  const row = instructionsRow();
  assert(row.includes("a value Claude Code's settings `env` holds (copied as typed"), row);
  assert(
    row.includes("or an MCP server's `env` in `.codex/config.toml` (whose reading Codex"),
    row,
  );
  assert(row.includes("when it holds a `$`, a backquote, a `~` or a `%`"), row);
  assert(
    row.includes("(where only `${VAR}` is expanded, from Claude Code's own environment)"),
    row,
  );
  assert(row.includes("when it holds anything but an exact `${PATH}`"), row);
  assert(row.includes("looked up both expanded and as written (`$PATH` copied as typed"), row);
});

Deno.test("the row names code a command assembles while it runs, and PATH bound otherwise", () => {
  const row = instructionsRow();
  assert(row.includes("a program named by an expansion or a pattern (`$CMD`, `./bin/l?nt`)"), row);
  assert(
    row.includes("handed to `eval`, a shell's `-c`, PowerShell's `-Command` or `cmd /c`"),
    row,
  );
  assert(row.includes("or held by a word read as a command line, a quoted sentence holding"), row);
  assert(row.includes("(no script, `-s`, `-`, `/dev/stdin`, a heredoc or a here-string)"), row);
  assert(row.includes("a process substitution (`<(…)`, `>(…)`, `=(…)`)"), row);
  assert(row.includes("(`read PATH`, `for PATH in`, `printf -v PATH`, `set -x PATH`"), row);
  assert(row.includes("or a binder whose name holds an expansion"), row);
  assert(row.includes("(a hook's `matcher`, a server's `url`, `cwd` or `headers`, an"), row);
  assert(notRead().includes("the code `python -c`, `node -e` or `perl -e` is handed"), notRead());
});

Deno.test("the row names the files a command runs in its own process, the one read, and its cost", () => {
  const row = instructionsRow();
  assert(row.includes("(`.` or `source`, `--rcfile` or `--init-file`, a `.ps1` or `.psm1`"), row);
  assert(row.includes("a `.bat` or `.cmd` run or `call`ed, `BASH_ENV` or `ENV`)"), row);
  assert(row.includes("or `ZDOTDIR`, `HOME` or `XDG_CONFIG_HOME` set"), row);
  assert(row.includes("a repository file named by a constant path from the project"), row);
  assert(row.includes("read at HEAD and at the tip for the `PATH` it sets when each of its"), row);
  assert(row.includes("the one target read for its text rather than judged by its bytes"), row);
  assert(row.includes("(a virtualenv's `activate`, nvm's or cargo's environment)"), row);
  assert(row.includes("so names its config on every merge"), row);
});
