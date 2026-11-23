import { isPathKey, isSurelyPath } from "./command_search_path.ts";

/**
 * Where a judged config sets the environment a command runs with, and how its harness reads a value
 * there, as each harness documents it. One table, keyed on the source file and the keys above the
 * value; a value set elsewhere is read as `unknown`:
 *
 * - Claude Code's settings `env`: copied as written, no shell processes it, so `$HOME` stays as
 *   typed (`literal`);
 * - `.mcp.json`: `${VAR}` and `${VAR:-default}` are expanded from Claude Code's own environment,
 *   where the project's variable is not set, and an unset one stays as written; a bare `$VAR` is not
 *   documented (`braced`);
 * - Codex's `shell_environment_policy.set` and an MCP server's `env`: not documented (`unknown`).
 *
 * A word a shell splits a command into (`PATH=./bin:$PATH lint`) is read as a shell reads it
 * (`shell`). A value is read both as expanded and as written (`command_targets.ts`): a semantics
 * only adds a reason not to read it whole, never removes a folder.
 */

/** How a value's `$`, `~` and `%` are read by what sets it. */
export type EnvSemantics = "shell" | "braced" | "literal" | "unknown";

type Surface = { readonly source: RegExp; readonly under: string; readonly reads: EnvSemantics };

const ENV_SURFACES: readonly Surface[] = [
  { source: /^\.claude\/settings(?:\.local)?\.json$/i, under: "env", reads: "literal" },
  { source: /^\.mcp\.json$/i, under: "env", reads: "braced" },
  { source: /^\.codex\/config\.toml$/i, under: "shell_environment_policy/set", reads: "unknown" },
  { source: /^\.codex\/config\.toml$/i, under: "env", reads: "unknown" },
];

/** The surface an object held under the keys `under` (the last two) is, or `undefined`. */
function surfaceKey(under: readonly string[]): string | undefined {
  if (under.join("/") === "shell_environment_policy/set") return "shell_environment_policy/set";
  return under.at(-1) === "env" ? "env" : undefined;
}

/**
 * Whether an object held under the keys `under` (the last two) sets the environment a command runs
 * with: an `env` object (a settings file's, an MCP server's), Codex's `shell_environment_policy.set`.
 */
export const isEnvSurface = (under: readonly string[]): boolean => surfaceKey(under) !== undefined;

/**
 * Whether a key `key` of an object held under `under` surely sets PATH: spelled `PATH`; or, in any
 * letter case, as Windows reads a variable's name, in an object that sets a command's environment.
 */
export function surelySetsPath(key: string, under: readonly string[]): boolean {
  return isSurelyPath(key) || (isEnvSurface(under) && isPathKey(key));
}

/** How the harness reads a value of an object held under `under` in the file `source`. */
export function semanticsOf(source: string, under: readonly string[]): EnvSemantics {
  const key = surfaceKey(under);
  const row = ENV_SURFACES.find((s) => s.under === key && s.source.test(source));
  return row?.reads ?? "unknown";
}

/**
 * Whether `value`, read with `semantics`, holds what its harness may not expand as a shell would:
 * any `$`, backquote, `~` or `%` where a value is copied as written or how it is read is not
 * documented, anything but an exact `${PATH}` where only braces are expanded. Such a value names a
 * folder spelled with it as written, or one a variable set outside the judged files decides.
 */
export function unpinned(value: string, semantics: EnvSemantics): boolean {
  if (semantics === "shell") return false;
  return /[$`~%]/.test(semantics === "braced" ? value.replaceAll("${PATH}", "") : value);
}
