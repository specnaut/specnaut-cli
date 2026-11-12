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
 * Every character a terminal acts on or a reader cannot see, refused by Unicode
 * property rather than by a list of ranges (cli#775): a list missed invisible
 * characters an agent still reads — Tag characters, invisible operators,
 * variation selectors, Hangul fillers. Matched one line at a time, so `\n`, the
 * one control a record holds, is never seen, and CR inside a CRLF pair is
 * reported as CRLF instead.
 */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

/** The name a refused character goes by in the refusal, from the first property it has. */
const KINDS: ReadonlyArray<[string, RegExp]> = [
  ["control", /\p{Cc}/u],
  ["format character", /\p{Cf}/u],
  ["line or paragraph separator", /[\p{Zl}\p{Zp}]/u],
  ["invisible character", /\p{Default_Ignorable_Code_Point}/u],
];

/** What is wrong with one history file, by name and content, or nothing. */
export function historyFileProblems(name: string, content: string): string[] {
  const problems: string[] = [];
  const raw = /^v(.+)\.md$/.exec(name)?.[1];
  // Round-tripped, so `v09.1.0.md` cannot embed as a release that is not its name.
  if (raw === undefined || SemVer.tryParse(raw)?.toString() !== raw) {
    problems.push(`${name}: not named v<MAJOR.MINOR.PATCH[-PRERELEASE]>.md`);
  }
  if (content.includes("\r\n")) problems.push(`${name}: CRLF line endings`);
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  return [...problems, ...forbiddenCharacters(lines).map((p) => `${name}: ${p}`)];
}

/** Each forbidden code point the lines hold, once, at its first line. */
function forbiddenCharacters(lines: string[]): string[] {
  const found = new Map<number, string>();
  lines.forEach((line, at) => {
    for (const [ch] of line.matchAll(FORBIDDEN)) {
      const cp = ch.codePointAt(0)!;
      if (found.has(cp)) continue;
      const kind = KINDS.find(([, p]) => p.test(ch))![0];
      const code = cp.toString(16).toUpperCase().padStart(4, "0");
      found.set(cp, `${kind} U+${code} on line ${at + 1}`);
    }
  });
  return [...found.values()];
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
