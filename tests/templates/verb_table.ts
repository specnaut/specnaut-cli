import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * A router's verb table, parsed — the one home of "which document a routable
 * verb reads" (plan 039 § 5). `/task` routes `groom` to `groom.md`, outside
 * `phases/`, so the document is read from the table rather than assumed.
 * Shared by `routable_phases_test.ts` and `constitution_first_test.ts`.
 */

/** The bundled router of `skill`. */
export function router(skill: string): string {
  const e = CORE_BUNDLE.find((x) =>
    (x.category === "skill" || x.category === "backlog-skill") && x.name === skill
  );
  if (!e) throw new Error(`no bundled router for ${skill}`);
  return e.content;
}

/**
 * The router's verb table, in row order: `| \`<verb> [args]\` | \`<doc>.md\` |`.
 * `/ship` routes by path, not by a verb table, so it yields nothing here and
 * its verbs are `phases/<verb>.md` by construction.
 */
export function verbTable(content: string): Array<{ verb: string; doc: string }> {
  const rows: Array<{ verb: string; doc: string }> = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^\| `([a-z][a-z-]*)[^`]*`(?: _[^|]*_)? \| `([a-z0-9/-]+\.md)` \|/);
    if (m) rows.push({ verb: m[1], doc: m[2] });
  }
  return rows;
}

/** The document a routable verb is read from, relative to its skill directory. */
export function docOf(skill: string, verb: string): string {
  return verbTable(router(skill)).find((r) => r.verb === verb)?.doc ?? `phases/${verb}.md`;
}
