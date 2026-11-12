/**
 * A shell line read as the shell would read it, for the one case a guard can judge without a
 * shell: one program and its words, and nothing else. A line the shell could read as a second
 * program, a substitution, a redirection, an expansion or a comment is not plain, so a guard that
 * allows a program by its words never allows a line that also runs another.
 */

/**
 * One piece of a word: a character the shell takes as itself, a single-quoted run (nothing inside
 * is special), or a double-quoted one holding none of the characters the shell reads inside double
 * quotes (`$`, a backtick, `\`, `!`). Controls are refused in all three, a newline included. Each
 * alternative starts with a character no other one starts with, so matching never backtracks.
 */
const PIECE = `[A-Za-z0-9_./:@%+=,-]|'[^'\\x00-\\x1f\\x7f]*'|"[^"$\`\\\\!\\x00-\\x1f\\x7f]*"`;

const WORD = `(?:${PIECE})+`;

const PLAIN_LINE = new RegExp(`^[ \\t]*${WORD}(?:[ \\t]+${WORD})*[ \\t]*$`);

const WORDS = new RegExp(WORD, "g");

const QUOTED = /'([^']*)'|"([^"]*)"/g;

/** The words of `line`, quotes removed; `null` when the line is not one plain command. */
export function plainWords(line: string): string[] | null {
  if (!PLAIN_LINE.test(line)) return null;
  return (line.match(WORDS) ?? []).map((w) =>
    w.replace(QUOTED, (_all, single?: string, double?: string) => single ?? double ?? "")
  );
}
