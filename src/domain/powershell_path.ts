import { encodedCommand, PS_PATH, PS_UNREAD_FORMS } from "./powershell_forms.ts";
import {
  type HashReading,
  normalizedPowerShell,
  type PsText,
  quotedEnd,
  writtenAs,
} from "./powershell_text.ts";

/**
 * How PowerShell sets PATH, read as text, never run: `$env:Path` or `${env:Path}` assigned a value,
 * whose words `pathAssignments` (`command_search_path.ts`) reads, and the ways of setting it that
 * reading cannot give whole. A static reader cannot run a cmdlet, so a value built by one is
 * named as not read whole rather than guessed at: a guessed folder describes a PATH other than the
 * one the command runs with.
 */

/** A word naming PowerShell's PATH, and what a glued `=` or `+=` sets it to. */
export const PS_PATH_WORD = new RegExp(`^${PS_PATH}(?:\\+?=(.*))?$`, "is");
const IS_PS_PATH = new RegExp(`^${PS_PATH}$`, "i");
/** Every PowerShell PATH in a text, for `replace` alone: a global regex keeps state across `test`. */
const EVERY_PS_PATH = new RegExp(PS_PATH, "gi");

/** `value` with each PowerShell PATH in it read as `$PATH`, the PATH in effect. */
export const psPathAsShell = (value: string): string => value.replace(EVERY_PS_PATH, "$$PATH");

/**
 * Whether `text` sets PATH, or may, in a way `pathAssignments` reads no value from: a form of
 * `powershell_forms.ts` (the `env:` drive, a provider, a new drive, an assignment of another shape,
 * code or a member built at run time, a write the next session inherits), searched in the text as
 * written and as PowerShell reads it (`powershell_text.ts`), each `#` inside a token read both
 * ways; or a PATH, or its assignment, that only the text as read spells (``${env:Pat`h}``,
 * `$env:Path <#…#>=`). Every assignment the reading finds is so either read from the text as
 * written, where it is spelled the same at the same place, or leaves its source unread.
 */
export function setsPathUnread(text: string): boolean {
  if (unreadForm(text)) return true;
  if (!/[`#]/.test(text)) return false;
  return HASH_READINGS.some((hash) => {
    const read = normalizedPowerShell(text, hash);
    return unreadForm(read.text) || spelledOnlyAsRead(read);
  });
}

const HASH_READINGS: readonly HashReading[] = ["comment", "literal"];

const unreadForm = (text: string): boolean =>
  PS_UNREAD_FORMS.some(([, pattern]) => pattern.test(text)) || encodedCommand(text);

/** PowerShell's PATH assigned, `=` or `+=`, glued or not. */
const PS_PATH_SET = new RegExp(`${PS_PATH}\\s*\\+?=`, "gi");

/** Whether a PATH or its assignment in `read` is not as written at the same place. */
function spelledOnlyAsRead(read: PsText): boolean {
  return [EVERY_PS_PATH, PS_PATH_SET].some((spelling) =>
    [...read.text.matchAll(spelling)].some((m) => !writtenAs(read, m.index, m.index + m[0].length))
  );
}

/**
 * One item of a PowerShell value, as its parser splits it before running anything: a statement's
 * end, a comment's `#`, a pipe or a call's `&`, blanks, PowerShell's PATH, a list's `@(`, a
 * bracket or a comma, and any other run of characters (a name, an operator, a variable). A quoted
 * string is one item up to its close, as PowerShell lexes it (`quotedEnd`). Every character starts
 * one, so the items cover the text.
 */
const ITEM = new RegExp(
  [
    "[;|&#\\r\\n]",
    "[^\\S\\r\\n]+",
    PS_PATH,
    "@\\(",
    "[(),]",
    "[^\\s'\"\u2018-\u201E(),;|&]+",
  ].join("|"),
  "isy",
);
const QUOTE = /['"\u2018-\u201E]/;
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
  const items: string[] = [];
  for (let at = from; at < text.length;) {
    const quoted = QUOTE.test(text[at]) || (text[at] === "@" && QUOTE.test(text[at + 1] ?? ""));
    const end = quoted ? quotedEnd(text, at) : itemEnd(text, at);
    const item = text.slice(at, end);
    if (END.test(item)) break;
    if (!BLANK.test(item)) items.push(item);
    at = end;
  }
  return items;
}

/** Where the item of {@link ITEM} starting at `at` ends. */
function itemEnd(text: string, at: number): number {
  ITEM.lastIndex = at;
  return at + (ITEM.exec(text)?.[0].length ?? 1);
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
 * anything (`$t = (Resolve-Path tools).Path`). A string PowerShell reads otherwise than its words
 * do is not read as written either: one holding a doubled quote (`'to''ols'`) or a backtick's
 * escape (``"tool`s"``), and one closed by a typographic quote, `‘’‚‛` for a `'…'` and `“”„` for
 * a `"…"`.
 */
function readableItem(item: string): boolean {
  if (TYPOGRAPHIC_QUOTE.test(item)) return false;
  if (/^(?:[,)]|@\()$/.test(item) || IS_PS_PATH.test(item)) return true;
  if (item.startsWith("'")) return /^'[^']*'?$/.test(item);
  return /^"[^"`]*"?$/.test(item) && !item.replace(EVERY_PS_PATH, "").includes("$");
}

/** The quotes PowerShell reads as `'` or `"` beside the ASCII ones, and `‟` with them. */
const TYPOGRAPHIC_QUOTE = /[\u2018-\u201F]/;
