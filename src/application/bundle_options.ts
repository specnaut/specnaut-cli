/**
 * The install parameter space: the options a harness maps the bundle against,
 * and every value each of them can take. Its own module because `ports.ts` is
 * the application's interfaces, and this is a value domain with a generator —
 * the two change for different reasons.
 */
import type { BacklogBackend, SpecBackend, VersionScheme } from "../domain/installed_lock.ts";
import {
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "../domain/installed_lock.ts";

export type BundleOptions = {
  /**
   * Which backlog backend's conditional sections and scripts the harness
   * should keep. Entries tagged with a different backend are filtered out;
   * the bundled SKILL.md is rendered with the matching markers stripped.
   */
  readonly backlogBackend: BacklogBackend;
  /**
   * Which versioning scheme the tag-release pack should compile down to.
   * `phase-script` entries with `# BEGIN: scheme=X` markers are rendered
   * against this value at bundle time.
   */
  readonly versionScheme: VersionScheme;
  /**
   * Which spec backend's conditional sections the phase docs should keep
   * (spec 020). The consuming phase docs (`specify` / `implement` / `review` /
   * `analyze` / `tasks`) carry `spec-backend=local|cloud` marker blocks rendered
   * against this value at bundle time. `local` yields output byte-identical to
   * the pre-feature CLI (FR-003).
   */
  readonly specBackend: SpecBackend;
  /**
   * Whether cloud-mode task creation should also auto-generate the task's spec
   * (spec 021 / FR-005). Governs the `spec-autogen=on` guidance block in the
   * backlog skill. Absent ⇒ `false` (opt-in, default off); the guidance only
   * renders when `specAutogen && specBackend === "cloud"`.
   */
  readonly specAutogen?: boolean;
};

/**
 * The value domain of every field of {@link BundleOptions} — the install
 * parameter space, in one place.
 *
 * **Keyed by `keyof Required<BundleOptions>`, and that is the whole point.**
 * A field added to `BundleOptions` makes this object literal fail to compile
 * with "property is missing", so the parameter space cannot silently narrow.
 * `Required<…>` is what extends that guarantee to *optional* fields, which is
 * where it was needed: `specAutogen` is optional, so every caller that never
 * mentioned it compiled fine and pinned it to `false` — and a size guard did
 * exactly that, measuring 16 of 32 combinations while reporting itself green
 * over a file that was 539 characters past its cap (#562).
 *
 * The values are **imported**, never retyped. `KNOWN_*` in
 * `domain/installed_lock.ts` is the single source for what values exist; a
 * hand-written copy here would be a fourth mirror of those lists, and this
 * repository already carries a scar from that shape (see
 * `domain/plugin_coverage.ts`).
 */
export const BUNDLE_OPTION_DOMAINS: {
  readonly [K in keyof Required<BundleOptions>]: ReadonlyArray<Required<BundleOptions>[K]>;
} = {
  backlogBackend: KNOWN_BACKLOG_BACKENDS,
  versionScheme: KNOWN_VERSION_SCHEMES,
  specBackend: KNOWN_SPEC_BACKENDS,
  specAutogen: [false, true],
};

/**
 * Every combination of {@link BUNDLE_OPTION_DOMAINS}, as the cross-product.
 *
 * Use this instead of nested `for` loops. A loop spells the axes it happens to
 * remember; this one cannot forget a field, because the field list is the type.
 * Order is the declaration order of `BUNDLE_OPTION_DOMAINS`, so the output is
 * stable and a failure message can name a combination reproducibly.
 */
export function everyBundleOption(): ReadonlyArray<Required<BundleOptions>> {
  const keys = Object.keys(BUNDLE_OPTION_DOMAINS) as Array<keyof Required<BundleOptions>>;
  let combos: Array<Record<string, unknown>> = [{}];
  for (const key of keys) {
    const widened: Array<Record<string, unknown>> = [];
    for (const combo of combos) {
      for (const value of BUNDLE_OPTION_DOMAINS[key]) {
        widened.push({ ...combo, [key]: value });
      }
    }
    combos = widened;
  }
  return combos as unknown as ReadonlyArray<Required<BundleOptions>>;
}
