/**
 * `CLAUDE_ENV_FILE`: the file a Claude Code `SessionStart` hook appends `export` lines to, which
 * the harness then sources before each shell command of the same session. It is how a value
 * reaches that one session's later commands and no other's.
 */

/** The `export` line that sets `name` to `value` when the file is sourced, quoted for the shell. */
export function exportLine(name: string, value: string): string {
  return `export ${name}='${value.replaceAll("'", `'\\''`)}'\n`;
}

/** Appends the line to the harness's file; the path comes from the environment, never a project. */
export async function exportToSession(envFile: string, name: string, value: string): Promise<void> {
  await Deno.writeTextFile(envFile, exportLine(name, value), { append: true });
}
