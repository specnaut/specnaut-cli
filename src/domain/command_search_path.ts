import { climb } from "./project_path.ts";
import { fold, linkOnTheWay, type PathIndex, submoduleOnTheWay } from "./path_index.ts";
import { PS_PATH_WORD, psPathAsShell } from "./powershell_path.ts";

/**
 * Which program a bare command name runs is decided by the folders on PATH, so a folder a judged
 * config puts there makes each file in it named like a word of a command a file that command may
 * run: `"env": {"PATH": "./bin:$PATH"}` and a hook `lint` run `bin/lint`. A command source names
 * such folders by a key `PATH` (a settings file's `env`, an MCP server's, Codex's shell policy) or
 * a word `PATH=…` or `PATH+=…` (set before a command, or exported), or PowerShell's `$env:Path`
 * or `${env:Path}` and every word after it (`$env:Path += ';bin'`), a list split on its commas
 * (`pathAssignments`). The key is read in any letter case, as Windows reads it, and in any object:
 * an unrelated key `path` (or a raw `--x-path=`) puts its value's folders on PATH too, which only
 * looks for more names in the listing. A folder that cannot be read makes the reading not whole
 * only when its value surely sets PATH: a key or a word spelled `PATH`, or a key `path` in any
 * letter case of an object that sets a command's environment (`surelySetsPath`). Any other is
 * skipped, or every merge would stop for an unrelated key. Only what the configs say is read: the
 * PATH a shell builds before the session starts is not.
 */

/** A key or a word that sets PATH, in any letter case. */
export const isPathKey = (key: string): boolean => /^path$/i.test(key);
const PATH_WORD = /^(path)\+?=(.*)$/is;

/** Whether a key or a word named `name` surely sets PATH: spelled as a shell spells it. */
export const isSurelyPath = (name: string): boolean => name === "PATH";

/**
 * Whether a key `key` of an object held under the keys `under` (the last two) surely sets PATH:
 * spelled `PATH`; or, in any letter case, as Windows reads a variable's name, in an object that
 * sets the environment a command runs with: a settings file's or an MCP server's `env`, Codex's
 * `shell_environment_policy.set`.
 */
export function surelySetsPath(key: string, under: readonly string[]): boolean {
  if (isSurelyPath(key)) return true;
  const sets = under.at(-1) === "env" || under.join("/") === "shell_environment_policy/set";
  return sets && isPathKey(key);
}

/** A value PATH may be set to, and whether what sets it surely sets PATH (`isSurelyPath`). */
export type PathValue = { readonly value: string; readonly sure: boolean };

/** What a word sets PATH to, when it sets it: `PATH=./bin:$PATH` sets it to `./bin:$PATH`. */
function pathWordValue(word: string): PathValue | undefined {
  const set = PATH_WORD.exec(word);
  return set ? { value: set[2], sure: isSurelyPath(set[1]) } : undefined;
}

/**
 * What the PATH assignments among one command's words set PATH to: each `PATH=…` word, and, from
 * the first word naming PowerShell's PATH, every word after it, its `=` or `+=` taken off, glued or
 * not (`$env:Path+=';x'`, `$env:Path +=';x'`). A value PowerShell joins from parts at a `;`
 * (`$env:Path + ';' + 'tools'`, `-join ';'`) is read part by part, a part too many only looking
 * for more names; a word holding a comma, which builds a list (`@('tools', $env:Path) -join
 * ';'`), is read whole and split on its commas, as the split words no longer say which comma was
 * quoted. Words read one by one give a value whole only so: not read here,
 * each naming its source as not read whole (`setsPathUnread`, `buildsPathUnread`): PATH set
 * through the `env:` drive (`Set-Item env:Path`, `New-Item`, `Set-Content`, an alias) or .NET's
 * `[Environment]::SetEnvironmentVariable('Path', …)`; a value holding a `(` (`(Resolve-Path
 * tools).Path`, `(Join-Path $PWD 'tools')`), a `$(…)`, a bare name, a pipeline (`|`) or a call
 * (`&`), which a cmdlet or a command builds; a variable other than PATH (`"$t;$env:Path"`), which
 * a line before may set to anything; a typographic quote (`’`, `”`), where PowerShell closes a
 * string; no item before the line's end (`$env:Path =⏎…`); parts joined other than at a `;`
 * (`'./to' + 'ols'`, `$env:Path + 'tools'`, `-join ''`) or by another operator (`-replace`, `-f`).
 * Not read at all: an assignment spelled across quotes a shell joins (`'$env:Path'' = …'`), whose
 * value is read from its words alone, as the string searched for it does not spell it.
 */
export function pathAssignments(words: readonly string[]): PathValue[] {
  const values = words.flatMap((word) => pathWordValue(word) ?? []);
  const at = words.findIndex((word) => PS_PATH_WORD.test(word));
  if (at < 0) return values;
  const rest = [PS_PATH_WORD.exec(words[at])![1] ?? "", ...words.slice(at + 1)]
    .map((word) => word.replace(/^\+?=/, ""))
    .flatMap((word) => word.includes(",") ? [word, ...word.split(",")] : [word])
    .filter(Boolean);
  return [...values, ...rest.map((value) => ({ value, sure: true }))];
}

/** A PATH key or assignment as raw bytes show it: not `$PATH` or `${PATH}`, which only read it. */
const RAW_PATH = /(?<![\w${])(path)\}?["']?\s*(?:[:=]|\+=)\s*["']?([^"'\s,&|]*)/gi;

/**
 * What each PATH key or assignment on a raw line sets PATH to: what a parser rejects is read. One
 * after a `-` is an option's name (`--out-path=`), never surely PATH.
 */
export function rawPathValues(line: string): PathValue[] {
  return [...line.matchAll(RAW_PATH)].filter((m) => m[2] !== "").map((m) => ({
    value: m[2],
    sure: isSurelyPath(m[1]) && line[m.index - 1] !== "-",
  }));
}

/**
 * The pieces of a PATH value, each a folder as written: `:` and Windows' `;` both separate, and
 * PowerShell's `$env:Path` is read as `$PATH`, the PATH in effect, before its `:` splits it.
 */
export const pathPieces = (value: string): string[] =>
  psPathAsShell(value).split(/[:;]/).filter(Boolean);

/** The extensions Windows tries a bare name with: `PATHEXT`'s default, and PowerShell's `.ps1`. */
const WINDOWS_EXTENSION = /\.(?:com|exe|bat|cmd|vbs|vbe|js|jse|wsf|wsh|msc|ps1)$/;

/** At most this many program-in-folder paths are tried: past it a reading is not whole. */
const MAX_ON_PATH = 50_000;

/** What the sources put on PATH: the folders, and every word that may be a program. */
export type OnPath = { readonly folders: Iterable<string>; readonly programs: Iterable<string> };

/**
 * Each program in each folder on PATH, as a path relative to the project's folder, looked up in
 * the commits' listings (`at`: HEAD's and the tip's). A program is any word a command holds by
 * name alone, so most name no file: a folder is tried with the names a commit holds in it that
 * answer to a program, bare or with a Windows extension (`lint.cmd` for `lint`), and how many words
 * or folders the sources hold does not grow what is tried. A folder a link or a submodule is on
 * the way to holds what no listing shows: it is tried with every program and every such name.
 * Past {@link MAX_ON_PATH} of those, none is tried and `read` is not whole: the caller names the
 * sources that put a folder there, rather than trust a part.
 */
export function onPathTargets(
  on: OnPath,
  at: readonly PathIndex[],
  read: { whole: boolean },
): string[] {
  const programs = [...new Set(on.programs)];
  const held = heldNames(new Set(programs.map(fold)), at);
  const dirs = new Set([...on.folders].map((dir) => climb([], dir).join("/")));
  const tried = [...dirs].map((dir) => ({ dir, names: namesIn(dir, at, programs, held) }));
  if (tried.reduce((n, t) => n + t.names.length, 0) > MAX_ON_PATH) {
    read.whole = false;
    return [];
  }
  return tried.flatMap(({ dir, names }) => names.map((n) => climb([], `${dir}/${n}`).join("/")));
}

/**
 * The names `dir` is tried with: those a commit holds in it, or every program and every such name
 * when a link or a submodule is on its way.
 */
function namesIn(dir: string, at: readonly PathIndex[], programs: readonly string[], held: Held) {
  const way = at.some((index) => (linkOnTheWay(dir, index) ?? submoduleOnTheWay(dir, index)));
  return way ? [...new Set([...programs, ...held.all])] : [...held.in.get(fold(dir)) ?? []];
}

/**
 * The names the commits hold that answer to a program:
 * by the folded folder holding each, and all.
 */
type Held = { readonly in: Map<string, Set<string>>; readonly all: Set<string> };

/**
 * Each name `at` holds, as it spells it, that is a program of `programs` (folded) or one with a
 * Windows extension.
 */
function heldNames(programs: ReadonlySet<string>, at: readonly PathIndex[]): Held {
  const held: Held = { in: new Map(), all: new Set() };
  for (const [key, paths] of at.flatMap((index) => [...index])) {
    const slash = key.lastIndexOf("/");
    const name = key.slice(slash + 1);
    if (!programs.has(name) && !programs.has(name.replace(WINDOWS_EXTENSION, ""))) continue;
    const dir = slash < 0 ? "" : key.slice(0, slash);
    for (const { path } of paths) {
      const spelled = path.slice(path.lastIndexOf("/") + 1);
      held.in.set(dir, (held.in.get(dir) ?? new Set()).add(spelled));
      held.all.add(spelled);
    }
  }
  return held;
}
