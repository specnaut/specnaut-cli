/**
 * Where the project's constitution and its gate configs live (spec 038, A-M3).
 *
 * The one TypeScript home of these literals. The hooks guard the same files
 * from `templates/harness-specific/shared/hooks/_paths.sh`, and
 * `tests/templates/hooks/paths_parity_test.ts` holds the two lists equal: a
 * path the binary writes but the hook does not guard is a file an agent may
 * rewrite unasked.
 */

/** The team's own document: bootstrapped once, never rewritten by Specnaut. */
export const CONSTITUTION_PATH = "docs/constitution.md";

/** Where releases before spec 038 wrote it, inside the framework's tree. Migrated, never read. */
export const LEGACY_CONSTITUTION_PATH = ".specnaut/memory/constitution.md";

/** The size thresholds a project sets; with none, the defaults in `size-limits.md` apply. */
export const SIZE_LIMITS_CONFIG_PATH = ".specnaut/size-limits.yml";

/** The import boundary the boundary gate checks. */
export const BOUNDARIES_CONFIG_PATH = ".specnaut/boundaries.yml";

/** The target-surface exception to the mobile-first default. */
export const UI_CONFIG_PATH = ".specnaut/ui.yml";

/**
 * The project-owned configs the gates read. Guarded like the constitution
 * because loosening one disarms its own gate. The bash gates read the first
 * two through `_config.sh`, whose literals `paths_parity_test.ts` pins here.
 */
export const GATE_CONFIG_PATHS: readonly string[] = [
  SIZE_LIMITS_CONFIG_PATH,
  BOUNDARIES_CONFIG_PATH,
  UI_CONFIG_PATH,
];
