import { parse as parseYaml } from "@std/yaml";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { splitFrontmatter } from "../../src/infrastructure/harness/frontmatter.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The constitution reference every task entry point opens with (plan 039 § 5).
 *
 * The one home of its wording and of the Claude import line. The templates are
 * static prompts, so they carry the sentence verbatim; the guard is what holds
 * every copy equal to this one. Both are built from `CONSTITUTION_PATH`, so the
 * path itself stays single-sourced in domain.
 */

/** The plain-words reference, on every harness. */
export const CONSTITUTION_REFERENCE =
  `Read \`${CONSTITUTION_PATH}\` before anything else: it is this project's binding rules, and no agent edits it unasked.`;

/** The line that makes Claude Code load the constitution at session start. */
export const CONSTITUTION_IMPORT = `@${CONSTITUTION_PATH}`;

/** The frontmatter key a skill opts out with; its value is the reason. */
export const EXEMPT_KEY = "constitution-exempt";

/**
 * How many leading non-blank lines precede the first instruction, per kind of
 * document (plan 039 § 6): a router's `#` title, the fence's heading and
 * ownership line, nothing otherwise. Stated per kind rather than guessed from
 * the text, so a verb document that grows a title above its reference is red
 * (FR-005: the reference is its first non-blank line), not skipped past.
 */
export const LEADING_LINES = { router: 1, verbDoc: 0, agent: 0, fence: 2 } as const;

/** Line endings as every template is compared: `\n` only. */
const lf = (text: string) => text.replaceAll("\r\n", "\n");

/**
 * The first instruction of a body: its first non-blank line once `skip`
 * leading non-blank lines are passed. Callers strip frontmatter, extract the
 * fence or parse the TOML first, so this one rule serves every kind of file.
 */
export function firstInstruction(body: string, skip: number): string | null {
  const lines = lf(body).split("\n").map((l) => l.trim()).filter((l) => l);
  return lines[skip] ?? null;
}

/** The line after the first instruction — where the fence's import must sit. */
export function secondInstruction(body: string, skip: number): string | null {
  return firstInstruction(body, skip + 1);
}

/** The first instruction of a file: its body without frontmatter, past `skip` lines. */
export function firstStep(content: string, skip: number): string | null {
  return firstInstruction(bodyOf(content), skip);
}

/** A file's body without its YAML frontmatter. */
export function bodyOf(content: string): string {
  return splitFrontmatter(lf(content))?.rest ?? content;
}

/** Values YAML reads as a boolean or null: present, but not a reason. */
const NOT_A_REASON = /^(true|false|yes|no|on|off|null|~)$/i;

/**
 * The exemption key as YAML reads it: absent, or present with its value.
 *
 * The one parse both exemption questions answer from. A line regex beside a
 * YAML parse disagreed on a quoted key — a reason to one, invisible to the
 * other — and a router that may not opt out did (cli#706). Malformed
 * frontmatter throws: a guard that cannot read a file must not pass it.
 */
function exemptEntry(content: string): { value: unknown } | null {
  const fm = splitFrontmatter(lf(content));
  if (!fm) return null;
  const parsed = parseYaml(fm.fmBody);
  if (parsed === null || typeof parsed !== "object" || !(EXEMPT_KEY in parsed)) return null;
  return { value: (parsed as Record<string, unknown>)[EXEMPT_KEY] };
}

/**
 * Why a skill opts out, or `null` when it does not — or claims to with an
 * empty, boolean-looking or non-string value, which the guard treats as no
 * reason at all. Read from the SOURCE: Codex rebuilds skill frontmatter and
 * drops the key.
 */
export function exemptionReason(content: string): string | null {
  const value = exemptEntry(content)?.value;
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "" || NOT_A_REASON.test(raw) ? null : raw;
}

/** Whether the frontmatter names the key at all, whatever its value. */
export function claimsExemption(content: string): boolean {
  return exemptEntry(content) !== null;
}

/**
 * What hides a token from Claude Code, matched in ONE pass so the leftmost
 * construct wins: an HTML comment, a fenced block, or a code span (which may
 * wrap onto the next line of its paragraph, never past a blank one). Stripped
 * one after the other, a `<!--` written as code opened a comment that
 * swallowed the imports after it (cli#706).
 */
// A code span opens on a run of N backticks and closes on a run of exactly N
// (CommonMark), never across a blank line: `` a ` b `` is one span.
const HIDDEN =
  /<!--[\s\S]*?-->|^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$|(`+)(?:(?!\2)(?!\n\s*\n)[\s\S])*?(?<!`)\2(?!`)/gm;

/**
 * The `@` import tokens Claude Code would follow in `text`, by its own rule:
 * `(^|\s)@<path>` in plain text, skipping fenced code blocks, inline code
 * spans and HTML comments (observed in the 2.1.309 resolver, plan 039 § 11).
 */
export function importTokens(text: string): string[] {
  const plain = lf(text).replace(HIDDEN, " ");
  return [...plain.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)].map((m) => `@${m[1]}`);
}

/** The one bundled entry with `suffix` among the project-root files. */
function projectRoot(suffix: string): CoreEntry {
  const hits = CORE_BUNDLE.filter((e) => e.category === "project-root" && e.suffix === suffix);
  if (hits.length !== 1) throw new Error(`${hits.length} project-root entries for ${suffix}`);
  return hits[0];
}

/** The scaffolded root `AGENTS.md`. */
export const agentsMd = (): CoreEntry => projectRoot("AGENTS.md");

/** The bootstrap constitution, written once to `docs/constitution.md`. */
export const constitutionTemplate = (): CoreEntry => projectRoot(CONSTITUTION_PATH);
