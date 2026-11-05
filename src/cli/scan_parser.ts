import { hasControl } from "../domain/terminal_text.ts";
import type { Intent, ScanIntent } from "./intent.ts";

/**
 * `specnaut scan`'s arguments, validated into its intent: the one home of what `--path` may be
 * (plan S8). A refusal is `unknown`, exit 2 with the help, as every parse-time refusal is; it never
 * echoes the value, which may hold anything a caller passed.
 */

const SCAN_FORMATS: readonly ScanIntent["format"][] = ["text", "json", "mermaid"];

/** How long each list is by default (FR-012): the measured cost of 20 is a few kilobytes. */
export const DEFAULT_TOP = 20;

const refused = (why: string): Intent => ({ kind: "unknown", received: `scan ${why}` });

export function parseScan(
  parsed: Readonly<Record<string, unknown>>,
  rest: readonly string[],
): Intent {
  if (rest.length > 0) return refused("takes no positional argument; name a subtree with --path");
  const format = parsed.format ?? "text";
  if (!SCAN_FORMATS.includes(format as ScanIntent["format"])) {
    return refused("--format takes text, json or mermaid");
  }
  const top = topOf(parsed.top);
  if (top === null) return refused("--top takes a whole number or all");
  const path = parsed.path;
  if (path !== undefined && !(typeof path === "string" && isScanPath(path))) {
    return refused("--path takes a relative path inside the repository, with no .. segment");
  }
  return { kind: "scan", path: path ?? null, format: format as ScanIntent["format"], top };
}

function topOf(raw: unknown): ScanIntent["top"] | null {
  if (raw === undefined) return DEFAULT_TOP;
  if (raw === "all") return "all";
  return typeof raw === "string" && /^[0-9]{1,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * A subtree git is handed as a literal pathspec after `--`, relative to the repository's root:
 * not empty, not an option, not absolute on any platform, no `..` segment, no control character.
 */
export function isScanPath(path: string): boolean {
  if (path === "" || path.startsWith("-") || hasControl(path)) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}
