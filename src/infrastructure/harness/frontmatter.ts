import { parse as parseYaml } from "@std/yaml";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export type FrontmatterParts = {
  readonly fmBody: string;
  readonly rest: string;
};

/**
 * Splits a markdown document into its YAML frontmatter body and the remaining content.
 * Returns null when the document has no frontmatter.
 */
export function splitFrontmatter(content: string): FrontmatterParts | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  return { fmBody: m[1], rest: m[2] };
}

/**
 * Extracts a single string field value from a YAML frontmatter body, or null if
 * the key is absent or the value is not a string. Properly handles block
 * scalars (`|`, `>`), multi-line values, and other valid YAML shapes by
 * delegating to `@std/yaml`.
 *
 * Malformed YAML throws rather than reading as absent: every caller reads a
 * bundled agent, and a `tools` line lost that way renders as the harness
 * default, every tool (tests/templates/frontmatter_parses_test.ts keeps the
 * shipped frontmatter strict).
 */
export function frontmatterField(fmBody: string, key: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(fmBody);
  } catch (e) {
    throw new Error(`frontmatter is not valid YAML, so "${key}" cannot be read`, { cause: e });
  }
  if (parsed && typeof parsed === "object" && key in parsed) {
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}
