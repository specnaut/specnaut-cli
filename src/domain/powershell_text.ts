/**
 * PowerShell's text as its tokenizer reads it, never run: a backtick escapes the next character
 * (``Pat`h`` is `Path`) or stands for one of its table (`` `n ``, `` `u{50} ``) or joins two lines,
 * and a comment (`<#…#>`, `#…`) is taken off. A string (`'…'`, `"…"`, `@'…'@`, `@"…"@`, the
 * typographic quotes) is left as written, but a `$(…)` inside a `"…"` is read as code. One pass,
 * no pattern that backtracks: the time is linear in the text, whatever a branch writes there.
 */

/**
 * How a `#` inside a token is read (`Write-Output a#b`): a comment or a character, which only the
 * parser knows, so a check searches both. In the `literal` one a string opened after such a `#`
 * ends at its line's end: no line PowerShell reads as code is swallowed by a comment's quote.
 */
export type HashReading = "comment" | "literal";

/** A text as PowerShell reads it, and the index each character has as written (-1: an escape's). */
export type PsText = { readonly text: string; readonly from: Int32Array };

const SINGLE = "'\u2018\u2019\u201A\u201B";
const DOUBLE = '"\u201C\u201D\u201E';
const isSingle = (c: string | undefined) => c !== undefined && c !== "" && SINGLE.includes(c);
const isDouble = (c: string | undefined) => c !== undefined && c !== "" && DOUBLE.includes(c);

/** The characters a backtick before a letter of this table stands for, outside a string. */
const ESCAPES = new Map([..."0abefnrtv"].map((c, i) => [c, "\0\x07\b\x1b\f\n\r\t\v"[i]]));

/** What a `#` always starts a token after: a comment in either reading. */
const TOKEN_START = /[\s;({|&,]/;
/** A here-string's opening: `@'` or `@"`, then blanks alone up to its line's end. */
const HERE_OPEN = /@(['"\u2018-\u201E])[^\S\n]*\r?\n/y;

/** What the scan is inside: code (a `$(…)` of a string's, `sub`, its brackets counted), or a string. */
type Frame = { code: true; depth: number; sub: boolean } | { code: false; here: boolean };
type Out = { text: string; hash: HashReading; chars: string[]; from: number[] };
type Scan = Out & { stack: Frame[]; i: number; cut: boolean };

/** `text` as PowerShell reads it, a `#` inside a token read as `hash` says. */
export function normalizedPowerShell(text: string, hash: HashReading = "comment"): PsText {
  const s = scan(text, hash, 0);
  while (s.i < text.length) step(s);
  return { text: s.chars.join(""), from: Int32Array.from(s.from) };
}

/**
 * Whether the characters of `t` from `start` to `end` are as written: each copied from the text,
 * one after another, none an escape stands for and none joined across a comment or a line's end.
 */
export function writtenAs(t: PsText, start: number, end: number): boolean {
  if (start >= end) return true;
  if (t.from[start] < 0) return false;
  for (let k = start + 1; k < end; k++) if (t.from[k] !== t.from[start] + k - start) return false;
  return true;
}

/** Where the quoted string that opens at `i` ends: past its closing quote, or the text's end. */
export function quotedEnd(text: string, i: number): number {
  const s = scan(text, "comment", i);
  step(s);
  while (s.stack.length > 1 && s.i < text.length) step(s);
  return s.i;
}

/** Each quoted string of `text` outside its comments: where it opens, and where it ends. */
export function quotedSpans(text: string): [number, number][] {
  const s = scan(text, "comment", 0);
  const spans: [number, number][] = [];
  while (s.i < text.length) {
    const at = s.i;
    const end = /['"\u2018-\u201E@]/.test(text[at]) ? quotedEnd(text, at) : at;
    if (end > at + 1 || (end > at && text[at] !== "@")) spans.push([at, s.i = end]);
    else step(s);
  }
  return spans;
}

function scan(text: string, hash: HashReading, i: number): Scan {
  const code: Frame = { code: true, depth: 0, sub: false };
  return { text, hash, chars: [], from: [], stack: [code], i, cut: false };
}

function step(s: Scan): void {
  const frame = s.stack.at(-1)!;
  if (frame.code) codeStep(s, frame);
  else stringStep(s, frame.here);
}

function codeStep(s: Scan, frame: Frame & { code: true }): void {
  const [c, next] = [s.text[s.i], s.text[s.i + 1]];
  if (c === "`") return escape(s);
  if (c === "#" || (c === "<" && next === "#")) return comment(s, c === "#" ? "\n" : "#>");
  if (c === "@" && here(s)) return;
  if (isSingle(c)) return copy(s, singleEnd(s.text, s.i, s.cut) - s.i);
  if (isDouble(c)) s.stack.push({ code: false, here: false });
  else if (c === "$" && next === "{") return braced(s);
  else if (c === "\n") s.cut = false;
  else if (c === "(") frame.depth++;
  else if (c === ")" && frame.sub && frame.depth-- === 0) s.stack.pop();
  copy(s, 1);
}

/** A `"…"` string's next character: its close, a doubled quote, an escape or a `$(` of code. */
function stringStep(s: Scan, here: boolean): void {
  const [c, next] = [s.text[s.i], s.text[s.i + 1]];
  const closes = here ? c === "\n" && isDouble(next) && s.text[s.i + 2] === "@" : isDouble(c);
  if (closes && !here && isDouble(next)) return copy(s, 2);
  if (closes || (c === "\n" && s.cut && !here)) s.stack.pop();
  if (closes) return copy(s, here ? 3 : 1);
  if (c === "\n" && s.cut && !here) return;
  if (c === "$" && next === "(") s.stack.push({ code: true, depth: 0, sub: true });
  copy(s, c === "`" || (c === "$" && next === "(") ? 2 : 1);
}

/** A backtick outside a string: a line joined, a character of the table, or the next as itself. */
function escape(s: Scan): void {
  const next = s.text[s.i + 1];
  const joins = next === "\n" ? 2 : next === "\r" && s.text[s.i + 2] === "\n" ? 3 : 0;
  if (next === undefined || joins > 0) return void (s.i += next === undefined ? 1 : joins);
  const point = /^u\{([0-9a-fA-F]{1,6})\}/.exec(s.text.slice(s.i + 1, s.i + 10));
  const code = point ? parseInt(point[1], 16) : -1;
  if (code >= 0 && code <= 0x10FFFF) {
    emit(s, String.fromCodePoint(code), -1);
    return void (s.i += 1 + point![0].length);
  }
  emit(s, ESCAPES.get(next) ?? next, ESCAPES.has(next) ? -1 : s.i + 1);
  s.i += 2;
}

/**
 * A comment from the `#` or `<#` at `s.i` up to `close`, taken off. One inside a token, in the
 * `literal` reading, is a character, and a string opened after it on its line ends there.
 */
function comment(s: Scan, close: string): void {
  if (s.i > 0 && !TOKEN_START.test(s.text[s.i - 1]) && s.hash === "literal") {
    s.cut = true;
    return copy(s, 1);
  }
  const end = s.text.indexOf(close, s.i + (close === "\n" ? 1 : 2));
  s.i = end < 0 ? s.text.length : close === "\n" ? end : end + close.length;
}

/** A braced variable, `${…}`: its name read through its escapes, as PowerShell reads it. */
function braced(s: Scan): void {
  copy(s, 2);
  while (s.i < s.text.length && s.text[s.i] !== "}") {
    if (s.text[s.i] === "`") escape(s);
    else copy(s, 1);
  }
  if (s.i < s.text.length) copy(s, 1);
}

/**
 * Whether a here-string opens at `s.i`, which is then read: a `@'…'@` copied up to its close at a
 * line's start, a `@"…"@` read as a `"…"` is.
 */
function here(s: Scan): boolean {
  HERE_OPEN.lastIndex = s.i;
  const open = HERE_OPEN.exec(s.text);
  if (open === null) return false;
  if (isDouble(open[1])) {
    s.stack.push({ code: false, here: true });
    copy(s, open[0].length - 1);
    return true;
  }
  let end = s.i + open[0].length - 1;
  while (end < s.text.length && !(isSingle(s.text[end + 1]) && s.text[end + 2] === "@")) {
    const line = s.text.indexOf("\n", end + 1);
    end = line < 0 ? s.text.length : line;
  }
  copy(s, Math.min(end + 3, s.text.length) - s.i);
  return true;
}

/** Where the `'…'` string opening at `i` ends; at its line's end when `cut`. */
function singleEnd(text: string, i: number, cut: boolean): number {
  for (let j = i + 1; j < text.length; j++) {
    if (cut && text[j] === "\n") return j;
    if (isSingle(text[j])) {
      if (!isSingle(text[j + 1])) return j + 1;
      j++;
    }
  }
  return text.length;
}

function copy(s: Scan, n: number): void {
  for (let k = 0; k < n && s.i < s.text.length; k++, s.i++) {
    s.chars.push(s.text[s.i]);
    s.from.push(s.i);
  }
}

function emit(s: Scan, decoded: string, from: number): void {
  for (const unit of decoded.split("")) {
    s.chars.push(unit);
    s.from.push(from);
  }
}
