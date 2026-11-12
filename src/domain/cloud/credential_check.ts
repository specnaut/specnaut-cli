// Text the binary sends to Specnaut Cloud is checked for credentials before the
// request. The patterns are the bash scan's (`scan_hard` in _report_text.sh), read
// from their one home, `_secret_patterns.txt`, as the template bundle carries it:
// this module keeps no list of its own. A refusal names the field and the class of
// the pattern that matched, never the value.
//
// The patterns are POSIX ERE run by grep in the C locale, so they are matched the way
// grep matches them: line by line, over the text's UTF-8 bytes.

import { CORE_BUNDLE } from "../../templates_bundle.ts";

/** Where the pattern file sits in the bundle: beside the bash scan that reads it too. */
const PATTERNS_SUFFIX = "scripts/bash/_secret_patterns.txt";

/** Which pattern matched: a token shape, a credential assigned a value, a scheme's value. */
export type CredentialKind = "token" | "assignment" | "scheme";

const WHAT: Record<CredentialKind, string> = {
  token: "a token",
  assignment: "a credential assigned a value, or an auth header",
  scheme: "a Bearer or Basic credential",
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

export type CredentialPatterns = {
  token: RegExp;
  assignment: RegExp;
  scheme: RegExp;
  tokenLike: RegExp;
};

/** Each name the file holds, the flags grep runs it with (`-i` or not), and its role. */
const NAMES = {
  SECRET_RE: ["token", "s"],
  SECRET_ANYCASE_RE: ["assignment", "is"],
  SCHEME_VALUE_RE: ["scheme", "gis"],
  TOKEN_LIKE_RE: ["tokenLike", "s"],
} as const;

/**
 * The patterns of a `_secret_patterns.txt` source, read as `_report_text.sh` reads
 * them: `name pattern` lines, a repeated name joined by `|`, other lines skipped.
 * Throws when a pattern is missing or uses a bracket class this translation does
 * not know: a check with less than the scan's patterns is no check.
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
    // [:space:] in the C locale; JavaScript has no POSIX classes.
    const js = ere.replaceAll("[:space:]", " \\t\\n\\v\\f\\r");
    const unknown = /\[:[a-z]+:\]/.exec(js);
    if (unknown) throw new Error(`${name} uses ${unknown[0]}, which the binary cannot read`);
    out[role] = new RegExp(js, flags);
  }
  return out as CredentialPatterns;
}

let bundled: CredentialPatterns | undefined;

/** The bundled patterns, compiled on first use. */
function bundledPatterns(): CredentialPatterns {
  if (bundled) return bundled;
  const file = CORE_BUNDLE.find((e) => e.suffix === PATTERNS_SUFFIX);
  if (!file) throw new Error("this build carries no credential patterns");
  return (bundled = compilePatterns(file.content));
}

/** The class of the first pattern the text matches, in the scan's order, or null. */
export function credentialKind(
  text: string,
  patterns: CredentialPatterns = bundledPatterns(),
): CredentialKind | null {
  const lines = bytesOf(text).split("\n");
  if (lines.some((l) => patterns.token.test(l))) return "token";
  if (lines.some((l) => patterns.assignment.test(l))) return "assignment";
  // `Bearer token` is prose: only a value shaped like a token is one. The value is
  // the second field `read` splits the match into, as scheme_value_in reads it.
  for (const line of lines) {
    for (const [match] of line.matchAll(patterns.scheme)) {
      if (patterns.tokenLike.test(match.split(/[ \t\n]+/)[1] ?? "")) return "scheme";
    }
  }
  return null;
}

/** Throws CredentialRefused for the first field whose text holds a credential. */
export function refuseCredentials(fields: Iterable<readonly [field: string, text: string]>): void {
  for (const [field, text] of fields) {
    const kind = credentialKind(text);
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
