/**
 * How the bundler writes a template's text into `src/templates_bundle.ts`.
 * Out of `bundle-templates.ts`, which sits at its size target, so the layout
 * rule can be tested at its boundary without reading the manifest.
 */

/** A template's text as the body of a JS template literal. */
export function escapeTemplateLiteral(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

/**
 * A `content:` field, laid out as `deno fmt` lays it out: when the literal's
 * first line runs past `lineWidth`, fmt moves the literal to its own line, so
 * the emitter does the same or `deno task bundle` dirties the tree for
 * `fmt --check` (spec 039: an agent body now opens with one long sentence).
 */
export function contentField(indent: string, content: string, lineWidth: number): string {
  const literal = `\`${escapeTemplateLiteral(content)}\``;
  const inline = `${indent}content: ${literal},\n`;
  return inline.split("\n")[0].length <= lineWidth
    ? inline
    : `${indent}content:\n${indent}  ${literal},\n`;
}
