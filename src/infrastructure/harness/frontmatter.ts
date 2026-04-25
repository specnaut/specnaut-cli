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
 */
export function frontmatterField(fmBody: string, key: string): string | null {
  try {
    const parsed = parseYaml(fmBody);
    if (parsed && typeof parsed === "object" && key in parsed) {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "string" ? value : null;
    }
  } catch {
    // malformed YAML → null
  }
  return null;
}
