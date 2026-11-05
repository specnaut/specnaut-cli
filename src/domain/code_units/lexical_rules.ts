import { isWordCode } from "./char_codes.ts";

/** What a family's lexer needs to know. The values live in `language_families.ts`. */
export interface StringRule {
  readonly open: string;
  readonly close: string;
  readonly multiline: boolean;
  readonly escapes: boolean;
  readonly interpolates?: boolean;
}

export interface LexicalRules {
  readonly lineComments: readonly { readonly open: string; readonly unless?: string }[];
  readonly blockComment?: {
    readonly open: string;
    readonly close: string;
    readonly nests: boolean;
  };
  /** Tried in order, so a longer opener goes before its prefix. */
  readonly strings: readonly StringRule[];
  /** `'` holds one character or an escape; anything else is a lifetime or a digit separator. */
  readonly charLiterals?: boolean;
  readonly regexLiterals?: boolean;
}

export type Opener =
  | { readonly kind: "line"; readonly open: string; readonly unless?: string }
  | { readonly kind: "block"; readonly open: string }
  | { readonly kind: "string"; readonly open: string; readonly rule: StringRule };

/** Keyed by first character, so a character that opens nothing costs one lookup. */
export function compileOpeners(rules: LexicalRules): Map<number, Opener[]> {
  const all: Opener[] = [];
  for (const line of rules.lineComments) all.push({ kind: "line", ...line });
  if (rules.blockComment) all.push({ kind: "block", open: rules.blockComment.open });
  for (const rule of rules.strings) all.push({ kind: "string", open: rule.open, rule });
  const byCode = new Map<number, Opener[]>();
  for (const opener of all) {
    const code = opener.open.charCodeAt(0);
    byCode.set(code, [...(byCode.get(code) ?? []), opener]);
  }
  return byCode;
}

function opensHere(opener: Opener, text: string, i: number): boolean {
  if (!text.startsWith(opener.open, i)) return false;
  // A prefix letter opens a string only at a word's start: `bar"x"` holds no raw string.
  if (isWordCode(text.charCodeAt(i)) && i > 0 && isWordCode(text.charCodeAt(i - 1))) return false;
  return !(opener.kind === "line" && opener.unless && text.startsWith(opener.unless, i + 1));
}

export function matchOpener(
  openers: Map<number, Opener[]>,
  text: string,
  i: number,
): Opener | null {
  const candidates = openers.get(text.charCodeAt(i));
  if (candidates === undefined) return null;
  for (const opener of candidates) {
    if (opensHere(opener, text, i)) return opener;
  }
  return null;
}

/** Which characters of a text are code, per family. Comments stay at the array's starting zero. */
export const CharRole = { Comment: 0, Code: 1, Text: 2 } as const;

export const Mode = { Code: 0, LineComment: 1, BlockComment: 2, Str: 3, Regex: 4 } as const;

export interface Machine {
  readonly text: string;
  readonly rules: LexicalRules;
  readonly mask: Uint8Array;
  readonly openers: Map<number, Opener[]>;
  /** Open braces inside each `${` being read: only the top one moves. */
  readonly interpolations: number[];
  mode: (typeof Mode)[keyof typeof Mode];
  rule: StringRule;
  commentDepth: number;
  regexClass: boolean;
  prevCode: number;
  prevIndex: number;
}

export function endAtNewline(m: Machine, i: number): number {
  m.mode = Mode.Code;
  m.mask[i] = CharRole.Code;
  return i + 1;
}
