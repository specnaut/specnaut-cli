import { programAt } from "./assembled_code.ts";
import { climb } from "./project_path.ts";

/**
 * The files a command runs in its own process, whose PATH, functions and aliases carry back into
 * it: a POSIX shell's `.` or `source`, bash's `--rcfile` and `--init-file`, a PowerShell script run
 * in the session (`.ps1` or `.psm1` called, dot-sourced or by its path, `Import-Module`, `using
 * module`), a batch file (`.bat` or `.cmd`, by its path or through `call`), and the file a variable
 * names for a shell to read at its start (`BASH_ENV`, `ENV`), or the folders it reads its start-up
 * files from (`ZDOTDIR`, `HOME`, `XDG_CONFIG_HOME`), set on a command or in a config's environment.
 *
 * Each makes the reading not whole, but for a repository file named as a constant path from the
 * project (`./env.sh`, `tools/env.sh`): its bytes are read at HEAD and at the tip
 * (`instruction_commands.ts`), and it is whole when every line of it is blank, a comment, or an
 * assignment of a constant, `$PATH` or the project's variable (`onlyAssignments`). Anything else may
 * define a function, an alias or a hashed path that a bare name then runs, which no reading of PATH
 * gives. A `pwsh -File` script runs in a process of its own, and carries nothing back.
 */

/** What the commands of a group carry over: whether one is not read whole, and the files to read. */
export type Carried = { unread: boolean; readonly files: string[] };

/** The variables a shell reads its start-up from, in any letter case, as Windows reads a name. */
const START_UP = /^(?:bash_env|env|zdotdir|home|xdg_config_home)$/i;
/** Those naming a file read whole, rather than a folder of start-up files. */
const START_FILE = /^(?:bash_env|env)$/i;
/**
 * A word that changes the folder a relative path is read from: a program in any letter case, as
 * PowerShell reads one, or `env`'s option (`-C`, `--chdir`), as written.
 */
const MOVES = /^(?:cd|pushd|popd|chdir|set-location|sl|push-location|pop-location)$/i;
const movesFolder = (word: string) =>
  MOVES.test(word) || word === "-C" || word.startsWith("--chdir");

/**
 * What the commands of a group carry over. `moved`: the group runs from a folder of its own (a
 * server's `cwd`), from which a relative path is not the project's.
 */
export function carriedFiles(commands: readonly (readonly string[])[], moved = false): Carried {
  const carried: Carried = { unread: false, files: [] };
  for (const words of commands) {
    for (const operand of operandsOf(words)) note(carried, operand);
    for (const word of words) {
      const set = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word);
      if (set !== null) noteKey(carried, set[1], set[2]);
      if (/^\$\{?env:(?:bash_env|env|zdotdir|home|xdg_config_home)\b/i.test(word)) {
        carried.unread = true;
      }
    }
  }
  const moves = moved || commands.some((words) => words.some(movesFolder));
  if (moves && carried.files.length > 0) [carried.unread, carried.files.length] = [true, 0];
  return carried;
}

/** Notes in `carried` what a key `key` set to `value` carries: a start-up file, or not whole. */
export function noteKey(carried: Carried, key: string, value: string): void {
  if (!START_UP.test(key)) return;
  if (START_FILE.test(key)) note(carried, value);
  else carried.unread = true;
}

/** Notes `written` as a file to read, or the reading as not whole when it names none. */
function note(carried: Carried, written: string | undefined): void {
  const file = written === undefined ? undefined : repositoryFile(written);
  if (file === undefined) carried.unread = true;
  else if (!carried.files.includes(file)) carried.files.push(file);
}

/**
 * A constant path from the project, as written: a slash in it (`./env.sh`), no expansion, no
 * pattern, not rooted, and inside the project. A bare name is searched on PATH first; any other
 * is not one file the repository holds.
 */
function repositoryFile(written: string): string | undefined {
  const path = written.replaceAll("\\", "/");
  if (!path.includes("/") || /[$`~%*?[{]/.test(path) || /^(?:[A-Za-z]:)?\//.test(path)) return;
  const parts = climb([], path);
  return parts.length === 0 || parts[0] === ".." ? undefined : parts.join("/");
}

/** A script PowerShell runs in its session, or cmd in its own, when named as a program. */
const IN_PROCESS = /\.(?:ps1|psm1|bat|cmd)$/i;

/** The file operands of one command that run a file in its process (the module's doc). */
function operandsOf(words: readonly string[]): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  words.forEach((word, i) => {
    const glued = /^--(?:rcfile|init-file)=(.*)$/s.exec(word);
    if (glued !== null) out.push(glued[1]);
    else if (word === "--rcfile" || word === "--init-file") out.push(words[i + 1]);
  });
  const at = programAt(words);
  if (at < 0) return out;
  const [program, rest] = [words[at].toLowerCase(), words.slice(at + 1)];
  const operand = rest[0] === "--" ? rest[1] : rest[0];
  if (program === "." || program === "source" || program === "call") out.push(operand);
  else if (program === "import-module" || program === "ipmo") {
    const names = rest.filter((w) => !w.startsWith("-"));
    out.push(...(names.length > 0 ? names : [undefined]));
  } else if (program === "using" && rest[0]?.toLowerCase() === "module") out.push(rest[1]);
  else if (IN_PROCESS.test(program)) out.push(words[at]);
  return out;
}

/** A file larger than this is not read: no file of assignments is. */
export const MAX_SOURCED_BYTES = 64 * 1024;

const SAFE = "[A-Za-z0-9_./:,@+=-]";
const REF = String
  .raw`\$(?:PATH|CLAUDE_PROJECT_DIR)(?![A-Za-z0-9_])|\$\{(?:PATH|CLAUDE_PROJECT_DIR)\}`;
const VALUE = `(?:${SAFE}|${REF}|"(?:${SAFE}| |${REF})*"|'(?:${SAFE}| )*')*`;
/** `[export] NAME=value`, the value a constant, `$PATH` or the project's variable. */
const ASSIGNED = new RegExp(`^(?:export[ \\t]+)?([A-Za-z_][A-Za-z0-9_]*)=${VALUE}[ \\t]*$`);

/**
 * Whether every line of `text` is blank, a comment, or an assignment of a constant, `$PATH` or the
 * project's variable, quoted or not, to a variable other than one a shell reads its start-up from.
 * No command, function, alias or source of another file: its PATH is then all it can carry over.
 */
export function onlyAssignments(text: string): boolean {
  return text.split(/\r?\n/).every((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return true;
    const set = ASSIGNED.exec(trimmed);
    return set !== null && !START_UP.test(set[1]);
  });
}
