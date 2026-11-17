/**
 * A command string split into words the way a shell would before it runs it, as far as a path is
 * concerned: quotes removed and the parts of one word joined (`"$DIR"/x.sh` is one word), a
 * `$(…)`, `${…}` or backquoted command kept whole inside its word, and a word ended by a blank or
 * by `;`, `&`, `|`, `<`, `>`, `(`, `)`. Nothing is expanded or run: a variable stays as written.
 */

/** What ends a word outside quotes. */
const SEPARATOR = /[\s;&|<>()]/;

/** What a backslash escapes outside quotes; before anything else it is kept, as in a Windows path. */
const ESCAPED = /[\s"'\\$`;&|<>()]/;

export function shellWords(text: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let i = 0;
  while (i < text.length) {
    if (SEPARATOR.test(text[i])) {
      if (word !== null) words.push(word);
      word = null;
      i++;
      continue;
    }
    const [part, next] = wordPart(text, i);
    word = (word ?? "") + part;
    i = next;
  }
  if (word !== null) words.push(word);
  return words;
}

/** The part of a word that starts at `i`, unquoted, and where the next part starts. */
function wordPart(text: string, i: number): [string, number] {
  const c = text[i];
  if (c === "'") return quoted(text, i, "'", false);
  if (c === "`") return quoted(text, i, "`", true);
  if (c === '"') return doubleQuoted(text, i);
  if (c === "$" && (text[i + 1] === "(" || text[i + 1] === "{")) {
    const end = closing(text, i + 1);
    return [text.slice(i, end + 1), end + 1];
  }
  if (c === "\\" && ESCAPED.test(text[i + 1] ?? "")) return [text[i + 1], i + 2];
  return [c, i + 1];
}

/** A quoted part up to its closing `quote` (or the text's end): its inside, or kept whole. */
function quoted(text: string, i: number, quote: string, keep: boolean): [string, number] {
  const close = text.indexOf(quote, i + 1);
  const end = close < 0 ? text.length : close;
  return [keep ? text.slice(i, end + 1) : text.slice(i + 1, end), end + 1];
}

/** A double-quoted part: `\"`, `\\`, `` \` `` and `\$` unescaped, a `$(…)` inside kept whole. */
function doubleQuoted(text: string, i: number): [string, number] {
  let out = "";
  let j = i + 1;
  while (j < text.length && text[j] !== '"') {
    if (text[j] === "$" && text[j + 1] === "(") {
      const end = closing(text, j + 1);
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
