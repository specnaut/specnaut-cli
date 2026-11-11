/**
 * The release history the bundler embeds, and what a history file may contain
 * (cli#759, FR-002, FR-005). Out of `bundle-templates.ts`, which is over its
 * size target; that script is its only caller.
 *
 * `specnaut upgrade` prints these highlights as they are, to a terminal and to
 * the agent reading its output. So the one check on them runs here, at bundle
 * time, and refuses rather than cleans: a release's text is first-party and
 * fixed by its author, and a runtime sanitiser would be a second rule that the
 * printed text and the committed file could disagree on.
 */

import { SemVer } from "../src/domain/release.ts";
import type { ReleaseHistory } from "../src/domain/release_notes.ts";
import { contentField } from "./bundle-content-field.ts";

/**
 * Each class a terminal or a reader can be misled by, one pattern per class.
 * C0 keeps `\n` (and CR inside a CRLF pair, which is its own class); DEL rides
 * with C0 because it is a control in the same range. Bidi covers embeddings,
 * overrides, isolates and marks; zero-width includes the byte-order mark.
 */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  // deno-lint-ignore no-control-regex -- matching control characters is this pattern's job
  ["C0 control", /[\u0000-\u0009\u000b-\u001f\u007f]/],
  ["C1 control", /[\u0080-\u009f]/],
  // Raw strings, not regex literals: `deno fmt` rewrites a literal's `\u` escapes into the
  // characters themselves, which would plant the invisible text this check refuses in its source.
  ["bidi control", new RegExp(String.raw`[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]`)],
  ["zero-width character", new RegExp(String.raw`[\u200b-\u200d\u2060\ufeff]`)],
];

/** What is wrong with one history file, by name and content, or nothing. */
export function historyFileProblems(name: string, content: string): string[] {
  const problems: string[] = [];
  const raw = /^v(.+)\.md$/.exec(name)?.[1];
  // Round-tripped, so `v09.1.0.md` cannot embed as a release that is not its name.
  if (raw === undefined || SemVer.tryParse(raw)?.toString() !== raw) {
    problems.push(`${name}: not named v<MAJOR.MINOR.PATCH>.md`);
  }
  if (content.includes("\r\n")) problems.push(`${name}: CRLF line endings`);
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  for (const [label, pattern] of FORBIDDEN) {
    const at = lines.findIndex((l) => pattern.test(l));
    if (at === -1) continue;
    const ch = pattern.exec(lines[at])![0].codePointAt(0)!;
    const code = ch.toString(16).toUpperCase().padStart(4, "0");
    problems.push(`${name}: ${label} U+${code} on line ${at + 1}`);
  }
  return problems;
}

/** Every history file in `dir`, in version order; throws naming each problem found. */
export async function readReleaseHistory(dir: URL): Promise<ReleaseHistory> {
  const entries: Array<{ version: SemVer; content: string }> = [];
  const problems: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    const content = e.isFile ? await Deno.readTextFile(new URL(e.name, dir)) : "";
    const found = historyFileProblems(e.name, content);
    if (!e.isFile) found.push(`${e.name}: not a file`);
    problems.push(...found);
    if (found.length === 0) entries.push({ version: SemVer.parse(e.name.slice(1, -3)), content });
  }
  if (problems.length > 0) {
    throw new Error(`Refused release history files:\n  - ${problems.sort().join("\n  - ")}`);
  }
  return entries
    .sort((a, b) => a.version.compare(b.version))
    .map((e) => ({ version: e.version.toString(), content: e.content }));
}

/** The array body of `RELEASE_HISTORY`, laid out as `deno fmt` lays it out. */
export function releaseHistoryEntries(history: ReleaseHistory, lineWidth: number): string {
  return history.map((e) =>
    `  {\n    version: ${JSON.stringify(e.version)},\n` +
    contentField("    ", e.content, lineWidth) +
    `  },\n`
  ).join("");
}
