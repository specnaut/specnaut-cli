import { normalizedPowerShell } from "./powershell_text.ts";

/**
 * The project's folder as the harness sets it: Claude Code's `CLAUDE_PROJECT_DIR`, the folder it
 * runs a command in. A PATH piece built from any other expansion names no folder that can be known
 * (`command_word_paths.ts`); this one is the project's folder, but only while nothing a branch
 * writes can make it another: spelled exactly `$CLAUDE_PROJECT_DIR` or `${CLAUDE_PROJECT_DIR}`,
 * and in no source spelled any other way, which may set it (an assignment, `export`, `read`, an
 * `env` key, `$env:…  =`), nor bound through a name only running a command gives (`eval`,
 * `export "$n=…"`). Read as text, never expanded.
 */

const NAME = "CLAUDE_PROJECT_DIR";

/** A piece that starts with the variable exactly, and what follows its first `/`. */
const LEAD = /^(?:\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\})(?:\/(.*))?$/s;

/**
 * What a PATH piece holds below the project's folder when the variable, exactly so spelled, is the
 * whole piece or its part before the first `/`: `""` for the folder itself, `bin` for
 * `$CLAUDE_PROJECT_DIR/bin`. `undefined` for any other piece.
 */
export function belowProject(piece: string): string | undefined {
  const lead = LEAD.exec(piece);
  return lead ? lead[1] ?? "" : undefined;
}

/** The name in any letter case, as Windows reads a variable's name. */
const SPELLED = /claude_project_dir/gi;
/** What makes a PowerShell spelling of it set it: an assignment, a compound one, or a list's `,`. */
const ASSIGNED = /^\}?\s*(?:(?:[-+*/%]|\?\?)?=|,)/;

/**
 * Whether `text` spells the name otherwise than reading it as written: `$CLAUDE_PROJECT_DIR`, or
 * `${CLAUDE_PROJECT_DIR}`, or PowerShell's `$env:…` or `${env:…}` assigned nothing. Searched as
 * written and as PowerShell reads it (``$env:CLAUDE_PROJECT_DI`R =``), each `#` read both ways.
 */
export function respellsProjectVariable(text: string): boolean {
  const read = /[`#]/.test(text)
    ? [normalizedPowerShell(text).text, normalizedPowerShell(text, "literal").text]
    : [];
  return [text, ...read].some((t) => [...t.matchAll(SPELLED)].some((m) => !readsAt(t, m.index)));
}

/** Whether the name at `at` in `text` is only read: one of the forms of the module's doc. */
function readsAt(text: string, at: number): boolean {
  const [before, after] = [text.slice(Math.max(0, at - 6), at), text.slice(at + NAME.length)];
  const exact = text.startsWith(NAME, at);
  if (exact && before.endsWith("${")) return after.startsWith("}");
  if (exact && before.endsWith("$")) return !/^\w/.test(after);
  const braced = /\$\{env:$/i.test(before);
  if (!braced && !/\$env:$/i.test(before)) return false;
  return (braced ? after.startsWith("}") : !/^\w/.test(after)) && !ASSIGNED.test(after);
}

/**
 * The words that bind a variable named by a word after them, an option glued to its name
 * (`read -a$n`) included: the shell's builtins, and `env`, which sets each `NAME=…` for the
 * command it runs. `printf` binds only the name its `-v` gives (`printf -v "$n"`, `printf -v$n`).
 */
const BINDERS = new Set(
  "export declare typeset local readonly read mapfile readarray getopts let env".split(" "),
);
const EXPANDS = /[$`]/;

/**
 * Whether one command's words may bind the variable through a name only running it gives: `eval`,
 * or a binder whose name holds an expansion (`export "$n=…"`, `env ${n}DIR=…`, `read $n`,
 * `mapfile $n`, `let "$n=1"`, `printf -v$n`).
 */
export function bindsByExpansion(words: readonly string[]): boolean {
  return words.some((word, at) => {
    if (word === "eval") return true;
    const v = words[at + 1] ?? "";
    const names = BINDERS.has(word)
      ? words.slice(at + 1)
      : word === "printf" && v.startsWith("-v")
      ? [v === "-v" ? words[at + 2] ?? "" : v.slice(2)]
      : [];
    return names.some((name) => EXPANDS.test(name.split("=")[0]));
  });
}
