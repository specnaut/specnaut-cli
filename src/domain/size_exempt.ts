import { anyGlobTakes, type CompiledGlob, compileGlobs } from "./case_glob.ts";
import { CONSTITUTION_PATH } from "./constitution_paths.ts";

/**
 * Which rule holds a tracked path: the one home of that decision (plan § 5). `size-ratchet.sh`'s
 * `is_exempt` is the bash asker of the same rule, and a differential fixture holds the two equal
 * both ways (SC-002), so a file the ratchet leaves out, the scan leaves out by the same rule.
 */

/** Why a path is left out, as the report counts it (FR-004). */
export const EXEMPT_REASONS = ["specnaut", "installed_lock", "exempt_glob", "binary"] as const;
export type ExemptReason = typeof EXEMPT_REASONS[number];

/** The unit a path is held to, or why it is held to none. */
export type HeldBy =
  | { readonly kind: "unit"; readonly unit: "file" | "constitution" }
  | { readonly kind: "exempt"; readonly reason: ExemptReason };

export type ExemptRules = {
  /** The paths `.specnaut/installed.lock` lists: Specnaut's own files, rewritten by `upgrade`. */
  readonly managed: ReadonlySet<string>;
  /** The config's `exempt:` globs, compiled, already within `exemptGlobsProblem`'s bounds. */
  readonly globs: readonly CompiledGlob[];
};

/** The rules of one scan, each glob compiled once when the config is read, never per path. */
export function exemptRules(managed: ReadonlySet<string>, globs: readonly string[]): ExemptRules {
  return { managed, globs: compileGlobs(globs) };
}

/**
 * The constitution first, before any exemption: it is loaded into every session, and an `exempt:`
 * glob does not reach it. Then Specnaut's own tree, the lock's entries and the globs, in the
 * ratchet's order. Binary files are decided apart (`binaryByAttribute`, `binaryBySize`,
 * `hasNulPrefix`), because the attribute comes from git and the sniff from the bytes.
 */
export function heldBy(path: string, rules: ExemptRules): HeldBy {
  if (path === CONSTITUTION_PATH) return { kind: "unit", unit: "constitution" };
  if (path.startsWith(".specnaut/")) return { kind: "exempt", reason: "specnaut" };
  if (rules.managed.has(path)) return { kind: "exempt", reason: "installed_lock" };
  if (anyGlobTakes(rules.globs, path)) return { kind: "exempt", reason: "exempt_glob" };
  return { kind: "unit", unit: "file" };
}

/** git's own sniff window: a NUL in the first 8000 bytes makes a blob binary. */
export const BINARY_SNIFF_BYTES = 8000;

/** git's default `core.bigFileThreshold`: a larger file is binary to `git diff` whatever it holds. */
const BIG_FILE_BYTES = 512 * 1024 * 1024;

/** Whether a file of `size` bytes is binary by its size alone, before a byte of it is read. */
export const binaryBySize = (size: number): boolean => size > BIG_FILE_BYTES;

/** Whether the first bytes of a file hold a NUL, as git judges a blob binary. */
export function hasNulPrefix(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * What `git check-attr diff` says about binariness: `unset` (`-diff`, or the `binary` macro) is
 * binary, `set` is text whatever the bytes, anything else leaves it to the size and the sniff.
 */
export function binaryByAttribute(value: string): boolean | null {
  if (value === "unset") return true;
  return value === "set" ? false : null;
}

/** Bounds on the config's globs: a path costs at most twice their total length times its own. */
export const MAX_EXEMPT_GLOBS = 128;
export const MAX_GLOB_LENGTH = 256;
export const MAX_GLOBS_TOTAL = 2048;

/** Why the globs cannot be used, or `null`: a config over a bound is refused, never trimmed. */
export function exemptGlobsProblem(globs: readonly string[]): string | null {
  if (globs.length > MAX_EXEMPT_GLOBS) {
    return `more than ${MAX_EXEMPT_GLOBS} exempt globs`;
  }
  const long = globs.findIndex((g) => g.length > MAX_GLOB_LENGTH);
  if (long >= 0) return `exempt glob ${long + 1} is over ${MAX_GLOB_LENGTH} characters`;
  const total = globs.reduce((sum, g) => sum + g.length, 0);
  return total > MAX_GLOBS_TOTAL ? `exempt globs total over ${MAX_GLOBS_TOTAL} characters` : null;
}
