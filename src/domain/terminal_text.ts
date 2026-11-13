/**
 * How untrusted text is made safe to print, one encoder per output grammar (plan S4). Text from a
 * server, a repository's file names or a git error reaches a terminal, a coding agent's context
 * and a diagram renderer; each grammar has its own escape, and none is raw interpolation.
 *
 * An escape stops a terminal or a renderer from acting on text. It does not stop text aimed at an
 * agent: that is why every report that carries such text also says it is data (FR-010).
 */

/**
 * The code points a terminal, an editor or a reader acts on rather than shows, by Unicode property
 * so no list can go stale: controls, format characters (bidi, zero-width, soft hyphen, tag
 * characters), surrogates, private use, unassigned, line and paragraph separators, and every
 * default-ignorable code point (variation selectors, Hangul fillers), which render as nothing.
 */
const UNSAFE_CLASS =
  "\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}";
const UNSAFE = new RegExp(`[${UNSAFE_CLASS}]`, "gu");

/**
 * JSON's set adds `<`, `>` and `&`: an agent's brief wraps the document in tags, and a path must
 * not close them. Outside a string JSON never holds these, so escaping them changes no value.
 */
const JSON_UNSAFE = new RegExp(`[${UNSAFE_CLASS}<>&]`, "gu");

const hex4 = (unit: number): string => `\\u${unit.toString(16).padStart(4, "0")}`;

/** One code point as JSON spells it: `\uXXXX`, or a surrogate pair of them above the BMP. */
const jsonEscaped = (c: string): string => c.split("").map((u) => hex4(u.charCodeAt(0))).join("");

/** One code point as text shows it: `\uXXXX`, or `\u{XXXXX}` above the BMP. */
function textEscaped(c: string): string {
  const cp = c.codePointAt(0)!;
  return cp > 0xffff ? `\\u{${cp.toString(16)}}` : hex4(cp);
}

/** Whether a value holds a C0, DEL or C1 control character. */
export function hasControl(value: string): boolean {
  // deno-lint-ignore no-control-regex
  return /[\x00-\x1f\x7f-\x9f]/.test(value);
}

/**
 * JSON with every unsafe code point escaped, which `JSON.stringify` leaves as it is for DEL, C1,
 * the format controls and `<>&`. Read back, it is the same value.
 */
export function terminalJson(value: unknown): string {
  return JSON.stringify(value).replace(JSON_UNSAFE, jsonEscaped);
}

/**
 * A run of backslashes a reader could take for the start of an escape: one right before a `u`, or
 * before a code point that is about to be shown as `\uXXXX`.
 */
const ESCAPE_LIKE = new RegExp(`\\\\+(?=u|[${UNSAFE_CLASS}])`, "gu");

/**
 * One line of human-readable text: every unsafe code point shown as an escape, and a backslash
 * doubled only where it stands before one, or before a `u`, so that a name which already reads
 * `\u001b` cannot pass for an escaped one. Read back, a run of backslashes before a `u` is literal
 * when even and starts an escape when odd; any other backslash is literal.
 *
 * Doubled only there, not everywhere (cli#785): a path is what a refusal asks the user to act on,
 * and a Windows path shown as `C:\\Users\\…` is not the one they would type. Where a folder name
 * starts with a `u`, its separator is still doubled, which Windows reads as the same path.
 *
 * The output is read back as a whole: it must not be joined directly to text that starts with a
 * `u`. A value ending in a single backslash keeps it single, and followed by `u001b` it would read
 * as an escape. Put a separator between them, or pass the joined text through here once.
 */
export function terminalText(value: string): string {
  return value.replace(ESCAPE_LIKE, (run) => run + run).replace(UNSAFE, textEscaped);
}

/**
 * The pass at an output sink (cli#776): a message whose parts were shown through `terminalText`
 * where they were composed, made inert as a whole. Unsafe code points are escaped; backslashes are
 * left alone, so a part escaped at its source is not escaped twice:
 * `inertText(terminalText(x)) === terminalText(x)`. A line feed is kept: a message may span lines,
 * and a new line is all a line feed does to a terminal.
 */
export function inertText(value: string): string {
  return value.replace(UNSAFE, (c) => c === "\n" ? c : textEscaped(c));
}

/** What a thrown value says, made inert for a terminal: the one form every error sink prints. */
export function errorText(err: unknown): string {
  return inertText(err instanceof Error ? err.message : String(err));
}

/**
 * An error no handler caught, as Deno's own handler would show it — name, message and stack — but
 * made inert like every other error sink (cli#785): its message can carry a repository's path or
 * a server's text, and the stack is what a bug report needs.
 */
export function uncaughtText(err: unknown): string {
  let said: string;
  try {
    said = err instanceof Error ? err.stack ?? `${err.name}: ${err.message}` : String(err);
  } catch {
    // A value with no string form, or whose stack getter throws: the printer must not throw too.
    said = UNPRINTABLE;
  }
  return `Uncaught ${inertText(said)}`;
}

/** What `uncaughtText` shows for a thrown value it cannot turn into text. */
export const UNPRINTABLE = "<unprintable thrown value>";

/** What a Mermaid label may hold as it is: no quote, bracket, `#`, `%`, `<` or backtick. */
const MERMAID_PLAIN = /^[A-Za-z0-9 _./,:()-]$/;

/**
 * A Mermaid label, written inside `"…"`: escaped as `terminalText` first, so no control reaches
 * the renderer even as an entity, then every character outside a small allowlist as `#<code>;`.
 * No quote can close the label, and no `%%`, `:::` or `click` can start a directive.
 */
export function mermaidLabel(value: string): string {
  let out = "";
  for (const c of terminalText(value)) {
    out += MERMAID_PLAIN.test(c) ? c : `#${c.codePointAt(0)};`;
  }
  return out;
}
