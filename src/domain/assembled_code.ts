import { isCommandLine } from "./nested_commands.ts";
import { psPathAsShell } from "./powershell_path.ts";
import { belowProject, bindsThroughExpansion } from "./project_variable.ts";
import { launch, shellOf } from "./shell_launch.ts";

/**
 * Code a command assembles while it runs, which no reading of its text gives: the reading of the
 * PATH it runs with, and of the files it runs, is then not whole. Keyed on positions, never on how
 * the code is spelled, since no list of spellings is complete:
 *
 * - (a) a program named by an expansion or a pattern: a command's word in a program's place holding
 *   a `$`, a backquote, a `{`, a `*`, a `?` or a `[` (`$CMD`, `./bin/l?nt`);
 * - (b) code built from an expansion: a word read as a command line of its own
 *   (`nested_commands.ts`), or the code handed to `eval`, to a shell's `-c` (`bash -c "$X"`), to
 *   PowerShell's `-Command`, or to `cmd /c`, holding any expansion but exact `$PATH`, `${PATH}`
 *   and the project's variable;
 * - (c) a shell reading its code from its input: one started with no script (`curl … | sh`), or
 *   with `-s`, `-`, `/dev/stdin`, a `/dev/fd/` file, a heredoc or a here-string;
 * - (d) a process substitution (`<(…)`, `>(…)`, zsh's `=(…)`), whose output a command reads as a
 *   file.
 *
 * And PATH set otherwise than by an assignment read: a binder whose name holds an expansion
 * (`project_variable.ts`), and a word spelled `PATH` that neither assigns nor reads it (`read
 * PATH`, `for PATH in`, `printf -v PATH`, fish's `set -x PATH`, csh's `setenv PATH`). The code a
 * `python -c`, `node -e` or `perl -e` is handed is not read: a limit the docs state.
 */

/**
 * Whether the commands a group of strings runs (`texts`, and `commands`, their words, nested
 * commands included) assemble code at run time, by any rule of the module's doc.
 */
export function runsAssembledCode(
  texts: readonly string[],
  commands: readonly (readonly string[])[],
): boolean {
  const words = commands.flat();
  if (texts.some((t) => SUBSTITUTION.test(t))) return true;
  if (words.some((w) => isCommandLine(w) && expands(w))) return true;
  const shells = commands.some((c) => c.some((w) => shellOf(w) !== undefined));
  if (shells && texts.some((t) => t.includes("<<"))) return true;
  return commands.some((command) =>
    computedProgram(command, words) || codeBuilt(command) || bindsPathOtherwise(command)
  );
}

/** A process substitution: `<(` or `>(`, or `=(` opening a word. */
const SUBSTITUTION = /[<>]\(|(?:^|[\s;&|(])=\(/;

/** The project's variable and PATH, exactly so spelled: expansions the reading reads. */
const READ = /\$(?:PATH|CLAUDE_PROJECT_DIR)(?!\w)|\$\{(?:PATH|CLAUDE_PROJECT_DIR)\}/g;

/**
 * Whether `text` holds an expansion the reading does not read: a `$` before anything but a blank,
 * or a backquote, once PowerShell's PATH is read as `$PATH` and the {@link READ} ones are taken
 * off; and, for `cmd`, a `%NAME%` other than `%PATH%` or a `!NAME!`.
 */
function expands(text: string, cmd = false): boolean {
  const rest = psPathAsShell(text).replace(READ, "");
  return /\$(?!\s|$)|`/.test(rest) || (cmd && /%(?!PATH%)[^%\s]+%|![^!\s]+!/i.test(rest));
}

/** Words before a command's program: a keyword that runs the next, or a program that runs it. */
const LEADS = new Set(
  "if then else elif do while until ! { time exec command builtin env".split(" "),
);
/** Words that start no command: what follows them is a name or a pattern, not a program. */
const NOT_COMMANDS = new Set(["for", "case", "select", "function", "[", "[["]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** The place of the program among one command's words, or -1 when it starts none. */
export function programAt(words: readonly string[]): number {
  const at = words.findIndex((w) => !ASSIGNMENT.test(w) && !LEADS.has(w));
  return at < 0 || NOT_COMMANDS.has(words[at]) ? -1 : at;
}

/**
 * Whether one command's program is named by an expansion or a pattern (rule (a)). The project's
 * variable before its first `/` is the project's folder (`belowProject`). A PowerShell variable
 * assigned (`$env:Path += …`, `$x = 1`) is no program, unless a word of the group binds the name a
 * shell would read there (`env=…`, `read x`), which would make it one.
 */
function computedProgram(words: readonly string[], all: readonly string[]): boolean {
  const at = programAt(words);
  if (at < 0) return false;
  const word = words[at];
  if (psAssigned(words, at, all)) return false;
  return /[$`{*?[]/.test(belowProject(word) ?? word);
}

const PS_VARIABLE = /^\$(?:\{([^}]+)\}|([\w:]+))/;
const ASSIGN = /^(?:[-+*/%]|\?\?)?=/;

/** Whether `words[at]` is a PowerShell variable assigned, its name bound by no word of `all`. */
function psAssigned(words: readonly string[], at: number, all: readonly string[]): boolean {
  const variable = PS_VARIABLE.exec(words[at]);
  if (variable === null) return false;
  const after = words[at].slice(variable[0].length);
  if (!ASSIGN.test(after === "" ? words[at + 1] ?? "" : after)) return false;
  const name = (variable[1] ?? variable[2]).split(":")[0];
  return !all.some((w) =>
    w === name || [`${name}=`, `${name}+=`, `${name}[`].some((b) => w.startsWith(b))
  );
}

/**
 * Whether one command hands code built from an expansion to `eval` or a shell, or starts a shell
 * that reads its code from its input (rules (b) and (c)).
 */
function codeBuilt(words: readonly string[]): boolean {
  return words.some((word, at) => {
    if (word === "eval") return expands(words.slice(at + 1).join(" "));
    const shell = shellOf(word);
    if (shell === undefined) return false;
    const run = launch(shell, words.slice(at + 1));
    return run.stdin || (run.code !== undefined && expands(run.code, shell === "cmd"));
  });
}

/**
 * A word that names PATH, as a binder's operand or a nameref's value (`read PATH`, `-vPATH`,
 * `p=PATH`), in any letter case.
 */
const PATH_NAME = /^(?:-[A-Za-z]*[av])?path$/i;

/**
 * Whether one command may set PATH otherwise than by an assignment the reading reads: a binder
 * whose name holds an expansion (`bindsThroughExpansion`), or a word naming PATH that is neither
 * `PATH=…` nor `export PATH`.
 */
function bindsPathOtherwise(words: readonly string[]): boolean {
  if (bindsThroughExpansion(words)) return true;
  return words.some((word, at) => {
    if (/^path\+?=/i.test(word) || (word === "PATH" && words[at - 1] === "export")) return false;
    return word.split("=").some((piece) => PATH_NAME.test(piece));
  });
}
