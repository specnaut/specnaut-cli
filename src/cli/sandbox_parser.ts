import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";

/**
 * `specnaut sandbox probe|exec`'s arguments, validated into its intent. The command to run is every
 * word after the first `--`, read from the raw argument list so none of it is taken as a flag or
 * turned into a number; the commit id and `--toolchain` come before it. A refusal is `unknown`,
 * exit 2 with the help, as every parse-time refusal is.
 */

const refused = (why: string): Intent => ({ kind: "unknown", received: `sandbox ${why}` });

export function parseSandbox(
  parsed: Readonly<Record<string, unknown>>,
  rest: readonly string[],
  argv: readonly string[],
): Intent {
  const dash = argv.indexOf("--");
  const command = dash >= 0 ? argv.slice(dash + 1) : null;
  const [sub, ...words] = rest;
  const after = command?.length ?? 0;
  if (after > words.length) return refused("takes its sub-command before --");
  const before = words.slice(0, words.length - after);
  if (sub === "probe") {
    if (before.length > 0 || command !== null) return refused("probe takes no argument");
    return { kind: "sandbox", sub: "probe" };
  }
  if (sub !== "exec") return { kind: "unknown", received: `sandbox ${sub ?? ""}`.trim() };
  return parseExec(parsed.toolchain, before, command);
}

/** `exec`'s words: one full commit id before `--`, a command after it, and `--toolchain`. */
function parseExec(
  rawToolchain: unknown,
  before: readonly string[],
  command: string[] | null,
): Intent {
  if (before.length !== 1 || !isFullSha(before[0])) {
    return refused("exec takes one full commit id before --");
  }
  if (command === null || command.length === 0) return refused("exec needs a command after --");
  const toolchain = toolchainOf(rawToolchain);
  if (toolchain === null) return refused("exec --toolchain takes absolute folders separated by :");
  return { kind: "sandbox", sub: "exec", sha: before[0], toolchain, command };
}

/** `--toolchain /a:/b`: absolute folders, `:` between them, as PATH lists them; none when absent. */
function toolchainOf(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (typeof raw !== "string") return null;
  const folders = raw.split(":");
  return folders.every((f) => f.startsWith("/")) ? folders : null;
}
