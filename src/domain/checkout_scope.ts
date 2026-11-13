import { SCRIPTS_DIR } from "./script_trust.ts";

/**
 * A folder of the checked files: every entry below it when `deep`, else only its own files, those
 * `names` lists when it lists any (matched without letter case: one file on a case-blind disk).
 */
export type ScopeRoot = {
  readonly dir: string;
  readonly deep: boolean;
  readonly names?: readonly string[];
};

/**
 * The instruction and config files a session or a review reads, `.gitattributes` (how git shows and
 * checks out the rest), and the version-manager files that could put another `specnaut`, `git` or
 * `gh` first on the PATH. `.specnaut/scripts/` is not here:
 * the script check judges it, with the bundle as a second copy.
 */
// deno-fmt-ignore
export const CHECKOUT_SCOPE: readonly ScopeRoot[] = [
  { dir: ".", deep: false, names: [
    "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", ".mcp.json",
    ".tool-versions", "mise.toml", ".mise.toml", "mise.local.toml", ".mise.local.toml",
    ".rtx.toml", ".envrc", ".prototools", "devbox.json", ".gitattributes",
  ] },
  { dir: ".claude", deep: true },
  { dir: ".codex", deep: true },
  { dir: ".agents", deep: true },
  { dir: ".specnaut", deep: false },
  { dir: ".specnaut/hooks", deep: true },
  { dir: ".specnaut/codex", deep: true },
  { dir: ".specnaut/addenda", deep: true },
  { dir: ".specnaut/memory", deep: true },
  { dir: "docs", deep: false, names: ["constitution.md"] },
  { dir: ".mise", deep: true },
  { dir: ".config", deep: false, names: ["mise.toml"] },
  { dir: ".config/mise", deep: true },
];

/** Whether `path`, relative to the project's root, belongs to `root`. */
export function inScopeRoot(root: ScopeRoot, path: string): boolean {
  if (root.deep && path === root.dir) return true; // the folder itself: a link or a submodule
  const prefix = root.dir === "." ? "" : `${root.dir}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return false;
  if (root.deep) return true;
  const name = path.slice(prefix.length);
  if (name.includes("/")) return false;
  const folded = name.toLowerCase();
  return root.names === undefined || root.names.some((n) => n.toLowerCase() === folded);
}

/** Whether `path` is inside a root the check walks whole: every file below it is compared. */
export function inDeepRoot(path: string): boolean {
  return !path.startsWith(`${SCRIPTS_DIR}/`) &&
    CHECKOUT_SCOPE.some((r) => r.deep && inScopeRoot(r, path));
}

/** The instruction files Claude Code and Codex read in any folder of the project, not only its root. */
export const INSTRUCTION_NAMES = [
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
] as const;

const FOLDED_NAMES = INSTRUCTION_NAMES.map((n) => n.toLowerCase());

/** Whether `path` is one of {@link INSTRUCTION_NAMES} in a folder below the root, case aside. */
export function isInstructionFile(path: string): boolean {
  const at = path.lastIndexOf("/");
  return at >= 0 && FOLDED_NAMES.includes(path.slice(at + 1).toLowerCase());
}

/** Whether `path` is one of the checked files: in a root, or an instruction file at any depth. */
export function inCheckoutScope(path: string): boolean {
  return !path.startsWith(`${SCRIPTS_DIR}/`) &&
    (CHECKOUT_SCOPE.some((r) => inScopeRoot(r, path)) || isInstructionFile(path));
}
