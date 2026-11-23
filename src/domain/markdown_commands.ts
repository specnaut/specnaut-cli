import { parse as parseYaml } from "@std/yaml";
import {
  commandWords,
  PARSE_LIMIT,
  parsedGroups,
  rawWords,
  type Reading,
} from "./command_words.ts";
import { valueEntries } from "./command_values.ts";

/**
 * The commands a Claude Code skill, agent or slash command holds in its own file: the `hooks:` its
 * frontmatter declares (the shape of a settings file's `hooks`) and the tools its `allowed-tools:`
 * grants; and, in a skill or a slash command only, each `` !`…` `` span and each ```` ```! ````
 * block, which Claude Code runs before the text is sent (an agent's file runs neither). The file
 * is judged byte for byte, so a command the branch changes is already named; these are read for
 * the files an unchanged one runs, as a config's are (`command_targets.ts`). The prose is not
 * read: a path it mentions is one a session may read, not one the harness runs, and reading it
 * would name every edit to a file a skill cites.
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

/** Whether Claude Code runs the `!` commands of the file at `path`: a skill's or a command's. */
const runsShell = (path: string) => /^\.claude\/(?:skills|commands)\//i.test(path);

/**
 * The groups of words the commands of `text`, the file at `path`, hold: its `!` spans and blocks
 * where they run, and its frontmatter's `hooks:` and `allowed-tools:` as parsed, so a YAML escape
 * reads as the harness reads it. A frontmatter past the parse limit, or that does not parse or
 * nests too deep, is read from all its lines, and the reading is not `whole`: the caller names the
 * file, rather than trust what a parser it disagrees with would run.
 */
export function markdownEntries(path: string, text: string, read: Reading): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const shell = runsShell(path)
    ? [...[...text.matchAll(BANG)].map((m) => m[1]), ...bangBlocks(lines)]
    : [];
  const commands = shell.map((command) => commandWords([command], read));
  const front = frontmatter(lines);
  return front === null ? commands : [...frontEntries(front, read), ...commands];
}

/**
 * The text of each fenced block opened with ```` ```! ````, Claude Code's form of a multi-line
 * command, up to the next line of at least as many backquotes alone, as Markdown closes it, or the
 * file's end. A shorter fence inside is part of the block: to a shell it opens a backquoted
 * command, which runs, so the words after it are read as a command of their own
 * (`nested_commands.ts`).
 */
function bangBlocks(lines: readonly string[]): string[] {
  const blocks: string[] = [];
  let body: string[] | null = null;
  let fence = 0;
  for (const line of lines) {
    if (body === null) {
      fence = /^\s*(`{3,})!/.exec(line)?.[1].length ?? 0;
      body = fence > 0 ? [] : null;
    } else if (/^`+$/.test(line.trim()) && line.trim().length >= fence) {
      blocks.push(body.join("\n"));
      body = null;
    } else body.push(line);
  }
  return body === null ? blocks : [...blocks, body.join("\n")];
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
    const parsed = parsedGroups(read, () => valueEntries(commandsOf(parseYaml(text)), read));
    if (parsed !== null) return parsed;
  }
  return front.map(rawWords);
}

/**
 * What a parsed frontmatter declares that runs or grants commands, its own keys only: `hooks:`,
 * and `allowed-tools:`, read as a settings file's permission rules are, since a script a grant
 * (`Bash(./scripts/deploy.sh *)`) lets run unasked is one the branch may change under it.
 */
function commandsOf(value: unknown): unknown[] {
  if (value === null || typeof value !== "object") return [];
  const own = value as Record<string, unknown>;
  return ["hooks", "allowed-tools"].filter((key) => Object.hasOwn(own, key)).map((key) => own[key]);
}
