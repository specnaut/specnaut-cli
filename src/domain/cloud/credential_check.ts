// Text the binary sends to Specnaut Cloud is checked for credentials before the
// request. The patterns are the bash scan's (`scan_hard` in _report_text.sh), from
// their one home, `_secret_patterns.txt`: this module compiles the text it is given
// and keeps no list of its own. The composition layer looks the file up in the
// template bundle and hands the compiled patterns to each client
// (application/credential_patterns.ts). A refusal names the field and the class of
// the pattern that matched, never the value.
//
// The patterns are POSIX ERE run by grep in the C locale, so they are matched the way
// grep matches them: line by line, over the text's UTF-8 bytes.
//
// Two modes, one pattern list. `scan` is scan_hard's rule, which the bash writers keep
// for text bound for a tracker: a credential keyword assigned a value, or an
// Authorization, Cookie or X-Api-Key header, is refused whatever follows it. `cloud`,
// what every client applies, refuses such a match only when its value is shaped like a
// token (TOKEN_LIKE_RE, the test a Bearer value already meets): a spec about
// authentication says `Authorization: Bearer <token>` or `token: required`, and a
// placeholder or a plain word is no credential. The token shapes (SECRET_RE, URL
// userinfo included) are refused the same in both.

import { assertPortable } from "./ere_portability.ts";

/** Which pattern matched: a token shape, a credential assigned a value, a scheme's value. */
export type CredentialKind = "token" | "assignment" | "scheme" | "session";

const WHAT: Record<CredentialKind, string> = {
  token: "a token",
  assignment: "a credential assigned a value, or an auth header",
  scheme: "a Bearer or Basic credential",
  session: "the Cloud token this session signs in with",
};

export class CredentialRefused extends Error {
  constructor(readonly field: string, readonly kind: CredentialKind) {
    super(
      `the ${field} holds what looks like ${WHAT[kind]} (${kind}); nothing was sent to ` +
        "Specnaut Cloud. Remove it and retry.",
    );
    this.name = "CredentialRefused";
  }
}

/** `scan`: scan_hard's strict rule; `cloud`: an assignment needs a token-shaped value. */
export type CheckMode = "scan" | "cloud";

export type CredentialPatterns = {
  token: RegExp;
  assignment: RegExp;
  scheme: RegExp;
  tokenLike: RegExp;
};

/** Each name the file holds, the flags grep runs it with (`-i` or not), and its role. */
const NAMES = {
  SECRET_RE: ["token", "s"],
  SECRET_ANYCASE_RE: ["assignment", "gis"],
  SCHEME_VALUE_RE: ["scheme", "gis"],
  TOKEN_LIKE_RE: ["tokenLike", "s"],
} as const;

/**
 * The patterns of a `_secret_patterns.txt` source, read as `_report_text.sh` reads
 * them: `name pattern` lines, a repeated name joined by `|`, other lines skipped.
 * Throws when a pattern is missing, or uses an ERE spelling JavaScript reads
 * differently (`assertPortable`): a check with less than the scan's patterns, or
 * other ones, is no check.
 */
export function compilePatterns(source: string): CredentialPatterns {
  const joined = new Map<string, string>();
  for (const line of source.split("\n")) {
    const [, name, pattern] = /^ *([^ ]*) *(.*?) *$/s.exec(line.replace(/\r$/, ""))!;
    if (!Object.hasOwn(NAMES, name)) continue;
    const before = joined.get(name);
    joined.set(name, before ? `${before}|${pattern}` : pattern);
  }
  const out: Partial<Record<keyof CredentialPatterns, RegExp>> = {};
  for (const [name, [role, flags]] of Object.entries(NAMES)) {
    const ere = joined.get(name);
    if (!ere) throw new Error(`the credential patterns have no ${name}`);
    assertPortable(name, ere);
    // [:space:] in the C locale; JavaScript has no POSIX classes.
    out[role] = new RegExp(ere.replaceAll("[:space:]", " \\t\\n\\v\\f\\r"), flags);
  }
  return out as CredentialPatterns;
}

/** The class of the first pattern the text matches, in the scan's order, or null. */
export function credentialKind(
  text: string,
  patterns: CredentialPatterns,
  mode: CheckMode = "cloud",
): CredentialKind | null {
  const lines = bytesOf(text).split("\n");
  if (lines.some((l) => patterns.token.test(l))) return "token";
  if (lines.some((l) => assigned(l, patterns, mode))) return "assignment";
  // `Bearer token` is prose: only a value shaped like a token is one. The value is
  // the second field `read` splits the match into, as scheme_value_in reads it.
  for (const line of lines) {
    for (const [match] of line.matchAll(patterns.scheme)) {
      if (patterns.tokenLike.test(match.split(/[ \t\n]+/)[1] ?? "")) return "scheme";
    }
  }
  return null;
}

/**
 * Whether the line assigns a credential. In `cloud` mode the value is what follows
 * the match's first `:` or `=`, past spaces and quotes, up to the next space, quote
 * or `<`; it must be token-shaped. (`search`, not `test`: the pattern is global.)
 */
function assigned(line: string, patterns: CredentialPatterns, mode: CheckMode): boolean {
  if (mode === "scan") return line.search(patterns.assignment) >= 0;
  for (const m of line.matchAll(patterns.assignment)) {
    const after = line.slice(m.index + m[0].search(/[:=]/) + 1);
    const value = /^[ \t\n\v\f\r"']*([^ \t\n\v\f\r"'<]*)/.exec(after)![1];
    if (patterns.tokenLike.test(value)) return true;
  }
  return false;
}

/**
 * Throws CredentialRefused for the first field whose text holds a credential: one a
 * pattern matches, or one of `held`, the tokens the session itself holds, whatever
 * their shape. They are compared in memory and never named. A client given no
 * patterns sends no written text at all: it fails closed.
 */
export function refuseCredentials(
  patterns: CredentialPatterns | undefined,
  fields: Iterable<readonly [field: string, text: string]>,
  held: readonly string[] = [],
): void {
  if (!patterns) throw new Error("no credential patterns were given: no text is sent to Cloud");
  // A token shorter than the scan's shortest value would match ordinary words.
  const tokens = held.filter((t) => t.length >= 8);
  for (const [field, text] of fields) {
    if (tokens.some((t) => text.includes(t))) throw new CredentialRefused(field, "session");
    const kind = credentialKind(text, patterns);
    if (kind) throw new CredentialRefused(field, kind);
  }
}

/**
 * A JSON value's text, as fields: its compact JSON, where a key and its value sit
 * together as `"key":"value"`, and every string it holds, keys included, unescaped.
 */
export function jsonFields(field: string, value: unknown): [string, string][] {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, inner] of Object.entries(v)) {
        strings.push(k);
        walk(inner);
      }
    }
  };
  walk(value);
  return [JSON.stringify(value) ?? "", ...strings].map((t) => [field, t]);
}

/** One character per UTF-8 byte: what grep sees in the C locale. */
function bytesOf(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}
