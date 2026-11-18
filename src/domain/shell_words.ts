/**
 * A command string split into words the way a shell would before it runs it, as far as a path is
 * concerned: quotes removed and the parts of one word joined (`"$DIR"/x.sh` is one word), a
 * `$(…)`, `${…}` or backquoted command kept whole inside its word, and a word ended by a blank or
 * by `;`, `&`, `|`, `<`, `>`, `(`, `)`. Nothing is expanded or run: a variable stays as written.
 */

/** What ends a word outside quotes. */
const SEPARATOR = /[\s;&|<>()]/;

/** What a backslash escapes outside quotes; before anything else it is kept, as a Windows path. */
const ESCAPED = /[\s"'\\$`;&|<>()]/;

export function shellWords(text: string): string[] {
  return shellSegments(text).flat();
}

/** What starts another command: `;`, `&`, `|`, a line's end. */
const NEXT_COMMAND = /[;&|\n\r]/;

/**
 * The words of each command `text` holds, one list per command: a new one after `;`, `&`, `|`, a
 * line's end, and at a `(` that opens a word (a subshell). A `(` inside a word, as in a permission
 * rule `Bash(npm test:*)`, only ends the word: what follows is not a command's first word.
 */
export function shellSegments(text: string): string[][] {
  const segments: string[][] = [[]];
  let word: string | null = null;
  let i = 0;
  while (i < text.length) {
    if (SEPARATOR.test(text[i])) {
      const opens = NEXT_COMMAND.test(text[i]) || (text[i] === "(" && word === null);
      if (word !== null) segments.at(-1)!.push(word);
      word = null;
      if (opens && segments.at(-1)!.length > 0) segments.push([]);
      i++;
      continue;
    }
    const [part, next] = wordPart(text, i);
    word = (word ?? "") + part;
    i = next;
  }
  if (word !== null) segments.at(-1)!.push(word);
  return segments.filter((s) => s.length > 0);
}

/** The part of a word that starts at `i`, unquoted, and where the next part starts. */
function wordPart(text: string, i: number): [string, number] {
  const c = text[i];
  if (c === "'") return quoted(text, i, "'");
  if (c === "`") {
    const end = backquoteEnd(text, i);
    return [text.slice(i, end + 1), end + 1];
  }
  if (c === '"') return doubleQuoted(text, i);
  if (c === "$" && (text[i + 1] === "(" || text[i + 1] === "{")) {
    const end = closing(text, i + 1);
    return [text.slice(i, end + 1), end + 1];
  }
  if (c === "\\" && ESCAPED.test(text[i + 1] ?? "")) return [text[i + 1], i + 2];
  return [c, i + 1];
}

/** A quoted part up to its closing `quote` (or the text's end): its inside. */
function quoted(text: string, i: number, quote: string): [string, number] {
  const close = text.indexOf(quote, i + 1);
  const end = close < 0 ? text.length : close;
  return [text.slice(i + 1, end), end + 1];
}

/**
 * The index of the backquote closing the one at `open`, or the text's length. A backslash escapes
 * the character after it, as bash reads a backquoted command: `` \` `` inside is a backquote of a
 * command nested in this one, never its close.
 */
export function backquoteEnd(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") return i;
  }
  return text.length;
}

/**
 * A double-quoted part: `\"`, `\\`, `` \` `` and `\$` unescaped, a `$(…)` or a backquoted command
 * inside kept whole, its own escapes with it.
 */
function doubleQuoted(text: string, i: number): [string, number] {
  let out = "";
  let j = i + 1;
  while (j < text.length && text[j] !== '"') {
    if (text[j] === "$" && text[j + 1] === "(") {
      const end = closing(text, j + 1);
      out += text.slice(j, end + 1);
      j = end + 1;
    } else if (text[j] === "`") {
      const end = backquoteEnd(text, j);
      out += text.slice(j, end + 1);
      j = end + 1;
    } else if (text[j] === "\\" && /["\\$`]/.test(text[j + 1] ?? "")) {
      out += text[j + 1];
      j += 2;
    } else out += text[j++];
  }
  return [out, j + 1];
}

/** The index of the bracket closing the `(` or `{` at `open`, or the text's last index. */
export function closing(text: string, open: number): number {
  const [o, c] = text[open] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c && --depth === 0) return i;
  }
  return text.length - 1;
}
