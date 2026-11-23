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
 * shell's.
 */
export const PS_PATH = /\$(?:env:path\b|\{env:path\})/gi;
/** A word naming PowerShell's PATH, and what a glued `=` or `+=` sets it to. */
export const PS_PATH_WORD = /^\$(?:env:path|\{env:path\})(?:\+?=(.*))?$/is;
const IS_PS_PATH = /^\$(?:env:path|\{env:path\})$/i;

/**
 * A word that sets PATH in a way no value is read from: the `env:` drive's `Path` item, which
 * `Set-Item`, `New-Item`, `Set-Content` and their aliases write, or .NET's
 * `SetEnvironmentVariable`. Its source is not read whole.
 */
const PS_PATH_UNREAD = /(?<![${])env:[\\/]?path\b|SetEnvironmentVariable/i;

/** Whether `word` sets PATH in a way `pathAssignments` reads no value from. */
export const setsPathUnread = (word: string): boolean => PS_PATH_UNREAD.test(word);

/** PowerShell's PATH assigned, `=` or `+=`, glued or not. */
const PS_PATH_SET = new RegExp(`${PS_PATH.source}\\s*\\+?=`, "gi");

/**
 * One item of a PowerShell value, as its parser splits it before running anything: a statement's
 * end or a comment's `#`, blanks, a quoted string up to its close (a backquote escapes inside
 * `"…"`), PowerShell's PATH, a list's `@(`, a bracket or a comma, and any other run of characters
 * (a name, an operator, a variable). Every character starts one, so the items cover the text.
 */
const ITEM = new RegExp(
  [
    "[;|&#\\r\\n]",
    "[^\\S\\r\\n]+",
    "'[^']*'?",
    '"(?:[^"`]|`.)*"?',
    PS_PATH.source,
    "@\\(",
    "[(),]",
    "[^\\s'\"(),;|&]+",
  ].join("|"),
  "isy",
);
const BLANK = /^[^\S\r\n]+$/;
const END = /^[;|&#\r\n]$/;

/**
 * Whether a command string assigns PowerShell's PATH a value no reading of its words gives whole
 * (`readableItem`); its source is then not read whole. The string is searched, not its words: the
 * split into words takes off the quotes and the brackets that say how the value is built, and an
 * assignment in a command nested in quotes (`pwsh -c "$env:Path = (…)"`) is in the string as
 * written. The value ends at `;`, `|`, `&`, a comment's `#` or a line's end outside quotes.
 */
export function buildsPathUnread(text: string): boolean {
  for (const set of text.matchAll(PS_PATH_SET)) {
    const value = valueItems(text, set.index + set[0].length);
    const list = value.some((item) => item === "," || item === "@(");
    if (!value.every((item) => readableItem(item, list))) return true;
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
 * Whether one item of a PATH value is read as written. A quoted string, unless a `$(…)` in it runs
 * a command; PowerShell's PATH; a variable; `+` or another operator (`-join`); a list's `@(`, `,`
 * or `)`. In a list (`@('tools', $env:Path)`, `'tools', $env:Path`) only a string holding no
 * variable but PATH, and PATH itself, are elements read as written. Any other item builds the value
 * from what only running it gives: a `(`, a `$(…)`, a bare name, which runs a command.
 */
function readableItem(item: string, list: boolean): boolean {
  if (/^(?:[,)+]|@\(|-[a-z]+)$/i.test(item) || IS_PS_PATH.test(item)) return true;
  if (item.startsWith("'")) return true;
  if (item.startsWith('"')) {
    return !item.includes("$(") && !(list && item.replace(PS_PATH, "").includes("$"));
  }
  return !list && item.startsWith("$") && item !== "$";
}
