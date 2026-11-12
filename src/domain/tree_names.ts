/**
 * The rules a name in a fetched tree must pass before it becomes a file on disk, and the files
 * that never become one. A tree object can hold any bytes as a name, and git itself refuses only
 * some of them on fetch: everything here runs before the first write, so a name that would leave
 * the export folder, alias another file, or plant a repository is refused rather than written.
 */

/**
 * Code points HFS+ ignores when it compares names, the list git's `is_hfs_dotgit` skips: with one
 * inside it, `.g\u200cit` opens as `.git` on such a volume.
 */
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu;

/** Characters a Windows path cannot hold in a name; `:` would open an alternate data stream. */
const WINDOWS_RESERVED = /[<>:"|?*]/;

/**
 * Names Windows opens as a device whatever the extension: the console pair, and `COM`/`LPT` with
 * any digit, the superscript ones included, which Windows also reads as a port number.
 */
const WINDOWS_DEVICE =
  /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/;

const MAX_NAME_BYTES = 255;

/** Why a tree entry's name is refused, or `null` when it may be written. */
export function nameFault(bytes: Uint8Array, windows: boolean): string | null {
  if (bytes.length === 0) return "an empty name";
  if (bytes.length > MAX_NAME_BYTES) return `a name over ${MAX_NAME_BYTES} bytes`;
  if (bytes.includes(0)) return "a NUL byte";
  // A lenient decode replaces each bad sequence with U+FFFD, so it round-trips only when the bytes
  // were UTF-8; `ignoreBOM` keeps a leading BOM, which a decode would otherwise drop.
  const name = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  if (!sameBytes(new TextEncoder().encode(name), bytes)) return "a name that is not UTF-8";
  // deno-lint-ignore no-control-regex -- matching the C0 and C1 controls is the point
  if (/[\x01-\x1f\x7f-\x9f]/.test(name)) return "a control character";
  if (/[/\\]/.test(name)) return "a path separator";
  if (name === "." || name === "..") return "a '.' or '..' step";
  if (isDotGit(name)) return "a spelling of .git";
  if (windows && WINDOWS_RESERVED.test(name)) return "a character Windows reserves";
  if (windows && isDevice(name)) return "a Windows device name";
  if (windows && /[. ]$/.test(name)) return "a name Windows would trim";
  return null;
}

/** A device name before any extension, spaces before the dot ignored as Windows ignores them. */
function isDevice(name: string): boolean {
  return WINDOWS_DEVICE.test(foldKey(name).split(".")[0].replace(/ +$/, ""));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * `.git` as any filesystem might read it: any case, trailing dots and spaces (Windows drops
 * them), an NTFS stream suffix, the 8.3 short name `git~1`, HFS+ ignorable code points.
 */
function isDotGit(name: string): boolean {
  const stem = foldKey(foldKey(name).split(":")[0]);
  return stem === ".git" || stem === "git~1";
}

/**
 * The key two names share when one filesystem would store them as one file: HFS+ ignorables
 * removed, Unicode-normalised (APFS and HFS+ ignore the form), case folded, trailing dots and
 * spaces dropped (Windows). Two entries of one folder with one key are twins, and the second would
 * overwrite or alias the first.
 */
export function foldKey(name: string): string {
  return name.replace(HFS_IGNORABLE, "").normalize("NFC").toUpperCase().toLowerCase()
    .replace(/[. ]+$/, "");
}

/**
 * Files a coding agent or its harness reads as instructions or configuration when it finds them
 * in a folder it works in. They are listed with their object id, never written: an exported copy
 * of the branch would otherwise hand its own instructions to whoever reads the export.
 */
const INSTRUCTION_FILES = new Set([
  "claude.md",
  "claude.local.md",
  "agents.md",
  "agents.override.md",
  "gemini.md",
  ".mcp.json",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  "opencode.json",
  "opencode.jsonc",
]);

/** Folders whose whole content is a harness's own: settings, skills, agents, hooks, rules. */
const INSTRUCTION_DIRS = new Set([
  ".claude",
  ".codex",
  ".cursor",
  ".gemini",
  ".opencode",
  ".agents",
  ".windsurf",
  ".vscode",
  ".specnaut",
]);

/** What Copilot reads under `.github/`; the rest of that folder (workflows, owners) is plain. */
const GITHUB_INSTRUCTIONS = new Set([
  "copilot-instructions.md",
  "instructions",
  "prompts",
  "agents",
  "chatmodes",
]);

/** Whether a path, given as its names, is or sits under an instruction or config file. */
export function instructionPath(names: readonly string[]): boolean {
  const keys = names.map(foldKey);
  if (INSTRUCTION_FILES.has(keys[keys.length - 1])) return true;
  return keys.some((k, i) =>
    INSTRUCTION_DIRS.has(k) || (k === ".github" && GITHUB_INSTRUCTIONS.has(keys[i + 1] ?? ""))
  );
}

/**
 * Whether a folder's entries make it a git repository to any git started inside it: `objects`,
 * `refs` and a `HEAD` together (git's `is_git_directory`, a bare repository's layout), or a
 * `commondir` or `gitdir` entry, which point a linked worktree's folder at its repository. Written
 * out, such a folder is discovered by a prompt, an editor or a session working in the copy, and its
 * `config` names programs (`core.fsmonitor`) that git then runs on the host.
 */
export function repositoryShaped(names: readonly string[]): boolean {
  const keys = new Set(names.map(foldKey));
  return (keys.has("head") && keys.has("objects") && keys.has("refs")) ||
    keys.has("commondir") || keys.has("gitdir");
}
