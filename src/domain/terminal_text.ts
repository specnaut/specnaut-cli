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
 * One line of human-readable text: every unsafe code point shown as an escape, and a backslash
 * doubled so that a name which already reads `\u001b` cannot pass for an escaped one.
 */
export function terminalText(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(UNSAFE, textEscaped);
}

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
