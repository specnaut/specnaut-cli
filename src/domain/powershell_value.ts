import { PS_PATH } from "./powershell_forms.ts";
import { quotedEnd } from "./powershell_text.ts";

/**
 * How a PowerShell PATH value is read, as text, never run: split into the items its parser reads
 * (`valueItems`), and read whole only when every item is read as written and every operator joins
 * its parts at a `;` (`readableValue`). The assignments it is read for are found in
 * `powershell_path.ts`.
 */

const IS_PS_PATH = new RegExp(`^${PS_PATH}$`, "i");
/** Every PowerShell PATH in a text, for `replace` alone: a global regex keeps state across `test`. */
const EVERY_PS_PATH = new RegExp(PS_PATH, "gi");

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

/** The items of the value starting at `from`, up to its statement's end, blanks aside. */
export function valueItems(text: string, from: number): string[] {
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
 * one by one; a list (`@('tools', $env:Path)`, `'tools', $env:Path`) is read element by element
 * only when the value ends in its `-join ';'`. PowerShell joins a list left as one with blanks
 * (`'tools', 'bin'` is `tools bin`), and anything after the `-join` is part of what it joins with.
 */
export function readableValue(value: readonly string[]): boolean {
  const join = value.findIndex((item) => item.toLowerCase() === "-join");
  const listed = value.some((item) => item === "," || item === "@(");
  if (listed && join !== value.length - 2) return false;
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
