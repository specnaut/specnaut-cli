import { parse as parseYaml } from "@std/yaml";
import {
  commandWords,
  PARSE_LIMIT,
  parsedGroups,
  rawWords,
  type Reading,
  valueEntries,
} from "./command_words.ts";

/**
 * The commands a Claude Code skill, agent or slash command holds in its own file: the `hooks:` its
 * frontmatter declares (the shape of a settings file's `hooks`), and each `` !`…` `` span, which
 * Claude Code runs before the command's text is sent. The file is judged byte for byte, so a
 * command the branch changes is already named; these are read for the files an unchanged one
 * runs, as a config's are (`command_targets.ts`). The prose is not read: a path it mentions is
 * one a session may read, not one the harness runs, and reading it would name every edit to a
 * file a skill cites.
 */

/** Whether `path` is a skill's `SKILL.md`, an agent or a slash command, its letter case aside. */
export function isCommandMarkdown(path: string): boolean {
  const p = path.toLowerCase();
  if (!p.endsWith(".md")) return false;
  if (p.startsWith(".claude/skills/")) return p.endsWith("/skill.md");
  return p.startsWith(".claude/agents/") || p.startsWith(".claude/commands/");
}

/** A `!` span: what Claude Code runs, whatever it spans up to the closing backquote. */
const BANG = /!`([^`]*)`/g;

/**
 * The groups of words `text`'s commands hold: its `!` spans, and its frontmatter's `hooks:` as
 * parsed, so a YAML escape reads as the harness reads it. A frontmatter past the parse limit, or that
 * does not parse or nests too deep, is read from all its lines, and the reading is not `whole`: the
 * caller names the file, rather than trust what a parser it disagrees with would run.
 */
export function markdownEntries(text: string, read: Reading): string[][] {
  const bangs = [...text.matchAll(BANG)].map((m) => commandWords([m[1]], read));
  const front = frontmatter(text.replace(/^\uFEFF/, "").split(/\r?\n/));
  return front === null ? bangs : [...frontEntries(front, read), ...bangs];
}

/** The lines between a first line `---` and the next, or `null` when there is no frontmatter. */
function frontmatter(lines: readonly string[]): string[] | null {
  if (lines[0]?.trimEnd() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  return end < 0 ? null : lines.slice(1, end);
}

function frontEntries(front: readonly string[], read: Reading): string[][] {
  const text = front.join("\n");
  if (text.length > PARSE_LIMIT) read.whole = false;
  else {
    const parsed = parsedGroups(read, () => valueEntries(hooksOf(parseYaml(text)), read));
    if (parsed !== null) return parsed;
  }
  return front.map(rawWords);
}

/** What a parsed frontmatter declares under `hooks:`, its own key only. */
function hooksOf(value: unknown): unknown {
  const owns = value !== null && typeof value === "object" && Object.hasOwn(value, "hooks");
  return owns ? (value as Record<string, unknown>).hooks : undefined;
}
