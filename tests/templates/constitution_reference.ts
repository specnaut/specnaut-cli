import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import {
  frontmatterField,
  splitFrontmatter,
} from "../../src/infrastructure/harness/frontmatter.ts";

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
 * The first instruction of a body: its first non-blank line once `skip`
 * leading non-blank lines are passed — the fence's heading and ownership line
 * (2). Callers strip frontmatter, extract the fence or parse the TOML first, so
 * this one rule serves every kind of file.
 */
export function firstInstruction(body: string, skip = 0): string | null {
  const lines = body.replaceAll("\r\n", "\n").split("\n").map((l) => l.trim()).filter((l) => l);
  return lines[skip] ?? null;
}

/** The line after the first instruction — where the fence's import must sit. */
export function secondInstruction(body: string, skip = 0): string | null {
  return firstInstruction(body, skip + 1);
}

/**
 * The first instruction of a file: its body without frontmatter, past one
 * leading `# ` title if it has one. Routers always open with a title; phase
 * docs sometimes do.
 */
export function firstStep(content: string): string | null {
  const body = bodyOf(content);
  return firstInstruction(body, firstInstruction(body)?.startsWith("# ") ? 1 : 0);
}

/** A file's body without its YAML frontmatter. */
export function bodyOf(content: string): string {
  return splitFrontmatter(content.replaceAll("\r\n", "\n"))?.rest ?? content;
}

/** Values YAML reads as a boolean or null: present, but not a reason. */
const NOT_A_REASON = /^(true|false|yes|no|on|off|null|~)$/i;

/**
 * Why a skill opts out, or `null` when it does not — or claims to with an
 * empty or boolean-looking value, which the guard treats as no reason at all.
 * Read from the SOURCE: Codex rebuilds skill frontmatter and drops the key.
 */
export function exemptionReason(content: string): string | null {
  const fm = splitFrontmatter(content.replaceAll("\r\n", "\n"));
  if (!fm) return null;
  const raw = frontmatterField(fm.fmBody, EXEMPT_KEY)?.trim() ?? "";
  return raw === "" || NOT_A_REASON.test(raw) ? null : raw;
}

/** Whether the frontmatter names the key at all, whatever its value. */
export function claimsExemption(content: string): boolean {
  const fm = splitFrontmatter(content.replaceAll("\r\n", "\n"));
  return fm !== null && new RegExp(`^${EXEMPT_KEY}\\s*:`, "m").test(fm.fmBody);
}

/**
 * The `@` import tokens Claude Code would follow in `text`, by its own rule:
 * `(^|\s)@<path>` in plain text, skipping fenced code blocks, inline code
 * spans and HTML comments (observed in the 2.1.309 resolver, plan 039 § 11).
 */
export function importTokens(text: string): string[] {
  const plain = text.replaceAll("\r\n", "\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, " ")
    // A code span may wrap onto the next line of its paragraph, never past a blank one.
    .replace(/`(?:[^`\n]|\n(?!\s*\n))*`/g, " ");
  return [...plain.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)].map((m) => `@${m[1]}`);
}
