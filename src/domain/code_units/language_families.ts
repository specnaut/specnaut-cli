import type { LexicalRules, StringRule } from "./lexical_rules.ts";

/**
 * One table, no class per language and no port (plan A12): the only place a language may differ.
 * Every field is data the scanners read; a branch on a family id anywhere else is a second home.
 */
export interface Family {
  readonly id: string;
  readonly extents: "brace" | "indent";
  readonly lexical: LexicalRules;
  readonly functionWords: ReadonlySet<string>;
  readonly classWords: ReadonlySet<string>;
  /** `name(...) {` is a function, as in C or a JS method; `notCallHeads` says when it is not. */
  readonly callHeads: boolean;
  readonly notCallHeads: ReadonlySet<string>;
  /** Words that follow a head keyword or precede `(` without ever naming the unit. */
  readonly neverNames: ReadonlySet<string>;
  readonly arrows: boolean;
  /** `class Name(...)` stays a class; elsewhere `struct a *f(...)` is a function returning one. */
  readonly classParams: boolean;
  /** Go: `Name struct {` puts the name first, and `struct{` or `func()` in a type is only a type. */
  readonly namedTypeLiterals: boolean;
  /** Go: no brace may start the body on a later line, so a line end drops a pending head. */
  readonly newlineEndsHead: boolean;
}

interface FamilyFields {
  readonly functionWords?: readonly string[];
  readonly classWords: readonly string[];
  readonly notCallHeads?: readonly string[];
  readonly neverNames?: readonly string[];
  readonly arrows?: boolean;
  readonly classParams?: boolean;
  readonly namedTypeLiterals?: boolean;
  readonly newlineEndsHead?: boolean;
}

function brace(id: string, lexical: LexicalRules, fields: FamilyFields): Family {
  return {
    id,
    extents: "brace",
    lexical,
    functionWords: new Set(fields.functionWords ?? []),
    classWords: new Set(fields.classWords),
    callHeads: fields.notCallHeads !== undefined,
    notCallHeads: new Set(fields.notCallHeads ?? []),
    neverNames: new Set(["extends", "implements", ...(fields.neverNames ?? [])]),
    arrows: fields.arrows ?? false,
    classParams: fields.classParams ?? false,
    namedTypeLiterals: fields.namedTypeLiterals ?? false,
    newlineEndsHead: fields.newlineEndsHead ?? false,
  };
}

function quoted(quote: string, multiline = false): StringRule {
  return { open: quote, close: quote, multiline, escapes: true };
}

function raw(open: string, close: string): StringRule {
  return { open, close, multiline: true, escapes: false };
}

const SLASHES = [{ open: "//" }];
const FLAT = { open: "/*", close: "*/", nests: false };
const NESTED = { ...FLAT, nests: true };

const SCRIPT_LEXICAL: LexicalRules = {
  lineComments: SLASHES,
  blockComment: FLAT,
  strings: [
    { open: "`", close: "`", multiline: true, escapes: true, interpolates: true },
    quoted('"'),
    quoted("'"),
  ],
  regexLiterals: true,
};

const C_LEXICAL: LexicalRules = {
  lineComments: SLASHES,
  blockComment: FLAT,
  strings: [quoted('"')],
  charLiterals: true,
};

/** Words that take `(...) {` or end a statement without a semicolon, yet open no function. */
// deno-fmt-ignore
const CONTROL = [
  "if", "else", "for", "while", "do", "switch", "catch", "try", "return", "throw", "new",
];
const SCRIPT_CONTROL = [...CONTROL, "export", "with"];
const CSHARP_CONTROL = [...CONTROL, "foreach", "using", "lock", "fixed", "checked", "unchecked"];

export const TYPESCRIPT = brace("typescript", SCRIPT_LEXICAL, {
  functionWords: ["function"],
  classWords: ["class", "interface"],
  notCallHeads: SCRIPT_CONTROL,
  arrows: true,
});

export const JAVASCRIPT = brace("javascript", SCRIPT_LEXICAL, {
  functionWords: ["function"],
  classWords: ["class"],
  notCallHeads: SCRIPT_CONTROL,
  arrows: true,
});

export const GO = brace("go", {
  ...C_LEXICAL,
  strings: [raw("`", "`"), quoted('"')],
}, {
  functionWords: ["func"],
  classWords: ["struct", "interface"],
  neverNames: ["chan", "map", "case", "return"],
  namedTypeLiterals: true,
  newlineEndsHead: true,
});

export const JAVA = brace("java", {
  ...C_LEXICAL,
  strings: [quoted('"""', true), quoted('"')],
}, {
  classWords: ["class", "interface", "enum", "record"],
  notCallHeads: [...CONTROL, "synchronized"],
  classParams: true,
});

export const CSHARP = brace("csharp", {
  ...C_LEXICAL,
  strings: [raw('"""', '"""'), raw('@"', '"'), raw('@$"', '"'), quoted('"')],
}, {
  classWords: ["class", "struct", "interface", "record"],
  notCallHeads: CSHARP_CONTROL,
  arrows: true,
  classParams: true,
});

export const RUST = brace("rust", {
  ...C_LEXICAL,
  blockComment: NESTED,
  // deno-fmt-ignore
  strings: [
    raw('r##"', '"##'), raw('r#"', '"#'), raw('br#"', '"#'), raw('r"', '"'), raw('br"', '"'),
    quoted('"', true),
  ],
}, { functionWords: ["fn"], classWords: ["struct", "enum", "union", "trait", "impl"] });

export const PHP = brace("php", {
  lineComments: [...SLASHES, { open: "#", unless: "[" }],
  blockComment: FLAT,
  strings: [quoted('"', true), quoted("'", true)],
}, {
  functionWords: ["function"],
  classWords: ["class", "interface", "trait", "enum"],
  neverNames: ["use"],
  classParams: true,
});

export const SWIFT = brace("swift", {
  lineComments: SLASHES,
  blockComment: NESTED,
  strings: [quoted('"""', true), raw('#"', '"#'), quoted('"')],
}, {
  functionWords: ["func", "init", "deinit", "subscript"],
  classWords: ["class", "struct", "enum", "protocol", "extension", "actor"],
});

export const KOTLIN = brace("kotlin", {
  ...C_LEXICAL,
  blockComment: NESTED,
  strings: [raw('"""', '"""'), quoted('"')],
}, { functionWords: ["fun"], classWords: ["class", "interface", "object"], classParams: true });

export const C = brace("c", C_LEXICAL, { classWords: ["struct", "union"], notCallHeads: CONTROL });

export const CPP = brace("cpp", {
  ...C_LEXICAL,
  strings: [raw('R"(', ')"'), quoted('"')],
}, { classWords: ["class", "struct", "union"], notCallHeads: CONTROL });

export const PYTHON: Family = {
  ...brace("python", {
    lineComments: [{ open: "#" }],
    strings: [quoted('"""', true), quoted("'''", true), quoted('"'), quoted("'")],
  }, { functionWords: ["def"], classWords: ["class"] }),
  extents: "indent",
};
