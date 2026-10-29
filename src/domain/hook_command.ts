/**
 * The exact spelling of every hook command Specnaut registers, and the
 * patterns that recognise them (spec 036, plan § 5 "Which hook entries in a
 * user's settings are Specnaut's").
 *
 * Recognition is by whole-command shape, anchored at both ends, never by a
 * mention of a Specnaut script: a user wrapper such as
 * `mycheck.sh && bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/guard-merge.sh"` is
 * the user's hook, and the merge replacing it would delete it with no backup.
 *
 * The Codex command is built and matched from ONE template (`codexShape`): the
 * pattern is the template with its variable parts punched out, so the
 * generator (`scripts/gen-hooks.ts`) and the matcher cannot drift apart.
 *
 * Pure — no IO, no Deno globals.
 */

/** What one Codex registration runs: a script of `.specnaut/hooks/`, its args, its refusal code. */
export type CodexHookCall = {
  readonly script: string;
  readonly args: string;
  /** A guard refuses (2) when the folder changed; a recorder lets the turn go on (0). */
  readonly onChanged: 0 | 2;
};

const SHA = `(sha256sum 2>/dev/null || shasum -a 256)`;
const CHECK =
  `(sha256sum -c --status SHA256SUMS 2>/dev/null || shasum -a 256 -c --status SHA256SUMS)`;

/**
 * The Codex command, every variable part a parameter. Codex trusts the hook
 * DEFINITION, never the script it runs (plan § 11 Measured), so the command pins
 * the hash of `SHA256SUMS` and checks the folder against it before running
 * anything: a changed script changes the definition, and Codex asks again.
 *
 * The root is the nearest folder above the session cwd holding a
 * `.specnaut/hooks/` directory — not the git toplevel, which for a project
 * nested in another repository without its own `.git` is the outer one. The
 * walk keys on the directory, not on `SHA256SUMS`: an inner project that lost
 * its sums must refuse, never fall through to an outer project's hooks.
 */
function codexShape(hash: string, script: string, args: string, exit: string): string {
  return [
    `r=$PWD; while [ -n "$r" ] && [ ! -d "$r/.specnaut/hooks" ]; do r=\${r%/*}; done`,
    `[ "$( ${SHA} < "$r/.specnaut/hooks/SHA256SUMS" 2>/dev/null | cut -c1-64)" = "${hash}" ]` +
    ` && (cd "$r/.specnaut/hooks" && ${CHECK})` +
    ` && exec bash "$r/.specnaut/hooks/${script}"${args}`,
    `echo "specnaut: .specnaut/hooks changed since it was trusted — run specnaut upgrade, then /hooks" >&2`,
    `exit ${exit}`,
  ].join("; ");
}

/** The shell command Codex runs for one registration: verify the folder, then exec the script. */
export function codexHookCommand(call: CodexHookCall, sumsHash: string): string {
  const args = call.args === "" ? "" : ` ${call.args}`;
  return codexShape(sumsHash, call.script, args, String(call.onChanged));
}

const SCRIPT_NAME = "([A-Za-z0-9_-]+)\\.sh";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `codexShape` with each variable part punched out: any hash, any script, any args, exit 0|2. */
function codexPattern(): RegExp {
  const hole = { hash: "\u0000H", script: "\u0000S", args: "\u0000A", exit: "\u0000E" };
  const source = escapeRegExp(codexShape(hole.hash, hole.script, hole.args, hole.exit))
    .replace(hole.hash, "[0-9a-f]{64}")
    .replace(hole.script, SCRIPT_NAME)
    .replace(hole.args, "(?: [a-z]+)?")
    .replace(hole.exit, "[02]");
  return new RegExp(`^${source}$`);
}

/**
 * Every shape a Specnaut hook command has, each capturing the script's basename:
 * the Claude registration (`templates/harness-specific/claude/settings.json`),
 * the Codex one (`codexHookCommand`), and the two scripts 7.1 registered under
 * `.claude/hooks/` before they moved — named, not globbed, because that folder
 * also holds the user's own scripts and `check-backlog-prereqs.sh`, which did
 * not move.
 */
export const SPECNAUT_HOOK_SHAPES: readonly RegExp[] = [
  new RegExp(`^bash "\\$CLAUDE_PROJECT_DIR/\\.specnaut/hooks/${SCRIPT_NAME}"(?: [a-z]+)?$`),
  codexPattern(),
  /^\.claude\/hooks\/(protect-generated|log-subagent)\.sh(?: (?:start|stop))?$/,
];
