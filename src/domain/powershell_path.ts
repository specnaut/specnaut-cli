/**
 * How PowerShell sets PATH, read as text, never run: `$env:Path` or `${env:Path}` assigned a value,
 * whose words `pathAssignments` (`command_search_path.ts`) reads, and the ways of setting it that
 * reading cannot give whole. A static reader cannot run a cmdlet, so a value built by one is
 * named as not read whole rather than guessed at: a guessed folder describes a PATH other than the
 * one the command runs with.
 */

/**
 * PowerShell's PATH, `$env:Path` or `${env:Path}`: in any letter case, as PowerShell reads a
 * variable's name, so always surely PATH. Inside a value it is the PATH in effect, as `$PATH` is a
 * shell's. The one source every regex below naming it is built from.
 */
const PS_PATH = String.raw`\$(?:env:path\b|\{env:path\})`;
/** A word naming PowerShell's PATH, and what a glued `=` or `+=` sets it to. */
export const PS_PATH_WORD = new RegExp(`^${PS_PATH}(?:\\+?=(.*))?$`, "is");
const IS_PS_PATH = new RegExp(`^${PS_PATH}$`, "i");
/** Every PowerShell PATH in a text, for `replace` alone: a global regex keeps state across `test`. */
const EVERY_PS_PATH = new RegExp(PS_PATH, "gi");

/** `value` with each PowerShell PATH in it read as `$PATH`, the PATH in effect. */
export const psPathAsShell = (value: string): string => value.replace(EVERY_PS_PATH, "$$PATH");

/**
 * A word that sets PATH in a way no value is read from: the `env:` drive's `Path` item, which
 * `Set-Item`, `New-Item`, `Set-Content` and their aliases write, or .NET's
 * `SetEnvironmentVariable`. Its source is not read whole.
 */
const PS_PATH_UNREAD = /(?<![${])env:[\\/]?path\b|SetEnvironmentVariable/i;

/** Whether `word` sets PATH in a way `pathAssignments` reads no value from. */
export const setsPathUnread = (word: string): boolean => PS_PATH_UNREAD.test(word);

/** PowerShell's PATH assigned, `=` or `+=`, glued or not. */
const PS_PATH_SET = new RegExp(`${PS_PATH}\\s*\\+?=`, "gi");

/**
 * One item of a PowerShell value, as its parser splits it before running anything: a statement's
 * end, a comment's `#`, a pipe or a call's `&`, blanks, a quoted string up to its close (a
 * backquote escapes inside `"…"`), PowerShell's PATH, a list's `@(`, a bracket or a comma, and any
 * other run of characters (a name, an operator, a variable). Every character starts one, so the
 * items cover the text.
 */
const ITEM = new RegExp(
  [
    "[;|&#\\r\\n]",
    "[^\\S\\r\\n]+",
    "'[^']*'?",
    '"(?:[^"`]|`.)*"?',
    PS_PATH,
    "@\\(",
    "[(),]",
    "[^\\s'\"(),;|&]+",
  ].join("|"),
  "isy",
);
const BLANK = /^[^\S\r\n]+$/;
const END = /^[;#\r\n]$/;

/**
 * Whether a command string assigns PowerShell's PATH a value no reading of its words gives whole
 * (`readableValue`); its source is then not read whole. The string is searched, not its words: the
 * split into words takes off the quotes and the brackets that say how the value is built, and an
 * assignment in a command nested in quotes (`pwsh -c "$env:Path = (…)"`) is in the string as
 * written. The value ends at `;`, a comment's `#` or a line's end outside quotes; a `|` or an `&`
 * before it is in the value, which a pipeline or a call builds. `+=` is read as `$env:Path +`. A
 * value with no item is not read whole: PowerShell reads it on the next line (`$env:Path =⏎…`).
 */
export function buildsPathUnread(text: string): boolean {
  for (const set of text.matchAll(PS_PATH_SET)) {
    const items = valueItems(text, set.index + set[0].length);
    const appended = set[0].endsWith("+=") ? ["$env:Path", "+"] : [];
    if (items.length === 0 || !readableValue([...appended, ...items])) return true;
  }
  return false;
}

/** The items of the value starting at `from`, up to its statement's end, blanks aside. */
function valueItems(text: string, from: number): string[] {
  const item = new RegExp(ITEM);
  item.lastIndex = from;
  const items: string[] = [];
  for (let m = item.exec(text); m && !END.test(m[0]); m = item.exec(text)) {
    if (!BLANK.test(m[0])) items.push(m[0]);
  }
  return items;
}

/**
 * Whether the words of a PATH value give it whole: each item read as written (`readableItem`), and
 * each operator joining its parts at a `;` (`joinsAtSemicolon`), as the words are read as folders
 * one by one; a list (`@('tools', $env:Path)`, `'tools', $env:Path`) is read element by element.
 */
function readableValue(value: readonly string[]): boolean {
  return value.every((item, at) =>
    OPERATOR.test(item) ? joinsAtSemicolon(value, at) : readableItem(item)
  );
}

const OPERATOR = /^(?:\+|-[a-z]+)$/i;

/**
 * Whether the operator at `at` joins the parts of a PATH value at a `;`: a `+` with a `;` on one
 * side of it inside the strings it joins (`$env:Path + ';tools'`, `'tools;' + $env:Path`), or
 * `-join ';'`. Any other join glues a folder from pieces (`'./to' + 'ols'`, `-join ''`), and any
 * other operator (`-replace`, `-f`) makes it from what only running it gives.
 */
function joinsAtSemicolon(value: readonly string[], at: number): boolean {
  if (value[at] === "+") {
    return inside(value[at - 1]).endsWith(";") || inside(value[at + 1]).startsWith(";");
  }
  return value[at].toLowerCase() === "-join" && /^(['"]);\1$/.test(value[at + 1] ?? "");
}

/** What a quoted item holds between its quotes; nothing for any other item. */
const inside = (item = ""): string =>
  /^['"]/.test(item) ? item.slice(1).replace(new RegExp(`${item[0]}$`), "") : "";

/**
 * Whether one item of a PATH value is read as written: PowerShell's PATH, a list's `@(`, `,` or
 * `)`, a `'…'` string, or a `"…"` string holding no `$` but PATH's. Any other item builds the value
 * from what only running it gives: a `(`, a `$(…)`, a bare name, which runs a command, a `|` or an
 * `&`, and a variable other than PATH (`$t`, `"${t};…"`), which a line before may have set to
 * anything (`$t = (Resolve-Path tools).Path`). A typographic quote is never read as written:
 * PowerShell closes a `'…'` at `‘’‚‛` and a `"…"` at `“”„`, where the items here see none.
 */
function readableItem(item: string): boolean {
  if (TYPOGRAPHIC_QUOTE.test(item)) return false;
  if (/^(?:[,)]|@\()$/.test(item) || IS_PS_PATH.test(item)) return true;
  if (item.startsWith("'")) return true;
  return item.startsWith('"') && !item.replace(EVERY_PS_PATH, "").includes("$");
}

/** The quotes PowerShell reads as `'` or `"` beside the ASCII ones, and `‟` with them. */
const TYPOGRAPHIC_QUOTE = /[\u2018-\u201F]/;
