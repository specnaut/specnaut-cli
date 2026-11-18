import { anyGlobTakes, type CompiledGlob, compileGlobs } from "./case_glob.ts";
import { CONSTITUTION_PATH } from "./constitution_paths.ts";
import { generatedByPath, generatedMayApply } from "./generated_code.ts";

/**
 * Which rule holds a tracked path: the one home of that decision (plan § 5). `_size_exempt.sh`,
 * which `size-ratchet.sh` sources, is the bash asker of the same rule, and a differential fixture
 * holds the two equal both ways (SC-002), so a file the ratchet leaves out, the scan leaves out by
 * the same rule.
 */

/** Why a path is left out, as the report counts it (FR-004). */
// deno-fmt-ignore
export const EXEMPT_REASONS = [
  "specnaut", "installed_lock", "exempt_glob", "binary", "generated",
] as const;
export type ExemptReason = typeof EXEMPT_REASONS[number];

/**
 * The unit a path is held to, or why it is held to none. `marker`: whether a generated header may
 * still exempt it once its bytes are read (`generated_code.ts`'s `hasGeneratedMarker`).
 */
export type HeldBy =
  | { readonly kind: "unit"; readonly unit: "file" | "constitution"; readonly marker: boolean }
  | { readonly kind: "exempt"; readonly reason: ExemptReason };

export type ExemptRules = {
  /** The paths `.specnaut/installed.lock` lists: Specnaut's own files, rewritten by `upgrade`. */
  readonly managed: ReadonlySet<string>;
  /** The config's `exempt:` globs, compiled, already within `exemptGlobsProblem`'s bounds. */
  readonly globs: readonly CompiledGlob[];
  /** Its `!` entries, the `!` dropped: files never generated, by name or by header. */
  readonly kept: readonly CompiledGlob[];
};

/** The rules of one scan, each glob compiled once when the config is read, never per path. */
export function exemptRules(managed: ReadonlySet<string>, globs: readonly string[]): ExemptRules {
  const kept = globs.filter((g) => g.startsWith("!"));
  const positive = globs.filter((g) => !g.startsWith("!"));
  return {
    managed,
    globs: compileGlobs(positive),
    kept: compileGlobs(kept.map((g) => g.slice(1))),
  };
}

/**
 * The constitution first, before any exemption: it is loaded into every session, and neither an
 * `exempt:` glob nor a generated header reaches it. A name holding a newline is never exempt, as
 * the ratchet holds it. Then Specnaut's own tree, the lock's entries, the positive globs and a
 * generated name, in the ratchet's order: a `!` entry, or a control character in the name, keeps
 * a file from the generated defaults only, never from a glob. Binary files are decided apart, in
 * `binary_sniff.ts`.
 */
export function heldBy(path: string, rules: ExemptRules): HeldBy {
  if (path === CONSTITUTION_PATH) return { kind: "unit", unit: "constitution", marker: false };
  if (path.includes("\n")) return { kind: "unit", unit: "file", marker: false };
  if (path.startsWith(".specnaut/")) return { kind: "exempt", reason: "specnaut" };
  if (rules.managed.has(path)) return { kind: "exempt", reason: "installed_lock" };
  if (anyGlobTakes(rules.globs, path)) return { kind: "exempt", reason: "exempt_glob" };
  const open = generatedMayApply(path) && !anyGlobTakes(rules.kept, path);
  if (open && generatedByPath(path)) return { kind: "exempt", reason: "generated" };
  return { kind: "unit", unit: "file", marker: open };
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
