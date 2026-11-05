import {
  C,
  CPP,
  CSHARP,
  type Family,
  GO,
  JAVA,
  JAVASCRIPT,
  KOTLIN,
  PHP,
  PYTHON,
  RUST,
  SWIFT,
  TYPESCRIPT,
} from "./language_families.ts";

export type Classification =
  | { readonly kind: "read"; readonly family: Family }
  | { readonly kind: "code_not_read" }
  | { readonly kind: "no_units_expected" };

const READ: ReadonlyArray<readonly [Family, readonly string[]]> = [
  [TYPESCRIPT, ["ts", "tsx", "mts", "cts"]],
  [JAVASCRIPT, ["js", "jsx", "mjs", "cjs"]],
  [GO, ["go"]],
  [JAVA, ["java"]],
  [CSHARP, ["cs"]],
  [RUST, ["rs"]],
  [PHP, ["php"]],
  [SWIFT, ["swift"]],
  [KOTLIN, ["kt", "kts"]],
  [C, ["c"]],
  // `.h` is C++ too: its class heads are a superset, and the extension cannot tell them apart.
  [CPP, ["cc", "cpp", "cxx", "hpp", "hh", "hxx", "h"]],
  [PYTHON, ["py", "pyi"]],
];

/** A `Map`, like every structure the estimator keys by what a repository chose (plan S9). */
const FAMILY_BY_EXTENSION: ReadonlyMap<string, Family> = new Map(
  READ.flatMap(([family, extensions]) => extensions.map((e) => [e, family] as const)),
);

// deno-fmt-ignore
const NO_UNITS: ReadonlySet<string> = new Set([
  "md", "mdx", "markdown", "txt", "rst", "adoc", "json", "jsonc", "json5", "yml", "yaml", "toml",
  "ini", "cfg", "conf", "xml", "html", "htm", "css", "scss", "less", "svg", "csv", "tsv", "lock",
]);

function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
}

/**
 * Everything unlisted is "code not read", never "no units expected": `.sh`, `.ps1`, `.rb` or a bare
 * `Makefile` may hold code, and silence must not read as clean (plan § 2).
 */
export function classifyPath(path: string): Classification {
  const extension = extensionOf(path);
  if (extension === null) return { kind: "code_not_read" };
  const family = FAMILY_BY_EXTENSION.get(extension);
  if (family !== undefined) return { kind: "read", family };
  return NO_UNITS.has(extension) ? { kind: "no_units_expected" } : { kind: "code_not_read" };
}
