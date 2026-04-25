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
 * Extracts a single-line YAML field value from a frontmatter body, or null if
 * the key is absent. Trims surrounding whitespace from the value.
 */
export function frontmatterField(fmBody: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = re.exec(fmBody);
  return m ? m[1].trim() : null;
}
