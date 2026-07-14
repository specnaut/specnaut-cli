import type { FsReader, Harness, LockStore } from "./ports.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { sha256Hex } from "../domain/sha256.ts";

/**
 * Per-file outcome of comparing a managed file's on-disk content against the
 * bundled original for the installed templates version (spec 011 / issue #367,
 * US2).
 *
 *  - `differs`  — on disk AND in the bundle, but the contents diverge. Carries
 *    both blobs so the handler can render a unified diff.
 *  - `matches`  — on disk and byte-identical to the bundled original.
 *  - `missing`  — lock-tracked (and present on disk) but absent from the new
 *    bundle: upstream dropped the file, the maintainer kept it (FR-009).
 */
export type DivergenceResult =
  | { kind: "differs"; dest: string; diskContent: string; bundledContent: string }
  | { kind: "matches"; dest: string }
  | { kind: "missing"; dest: string };

export type DiffProjectInput = {
  readonly projectDir: string;
  /**
   * When true, restrict the result set to paths whose on-disk SHA differs from
   * the lock SHA — i.e. files the maintainer actually customised. Default
   * (false) reports every lock-tracked managed path.
   */
  readonly onlyCustomised: boolean;
};

export type DiffProjectResult = {
  readonly results: ReadonlyArray<DivergenceResult>;
  /** Installed templates version the bundle was mapped for (lock version). */
  readonly fromVersion: string;
};

/**
 * Read-only dependencies for the divergence view. Deliberately carries **no
 * `FsWriter`**: observing divergence must mutate nothing (contract §4 / the
 * read-only invariant). The only ports are a reader, the lock store, the
 * embedded `CORE_BUNDLE`, and the harness resolver — exactly the inputs needed
 * to reconstruct the bundled original `upgrade` would compare against.
 */
export type DiffProjectDeps = {
  reader: FsReader;
  lockStore: LockStore;
  core: CoreBundle;
  findHarness: (key: string) => Harness | null;
};

/**
 * Computes, read-only, how each lock-tracked managed file diverges from its
 * bundled original for the installed templates version (US2 / FR-006).
 *
 * The bundle is mapped through the lock's harness/backend/scheme exactly the
 * way `upgrade` maps it, so the comparison is against the same bytes a refresh
 * would write. A path tracked in the lock but absent from the freshly-mapped
 * bundle is surfaced as `missing` rather than silently dropped (FR-009).
 */
export class DiffProjectUseCase {
  constructor(private readonly deps: DiffProjectDeps) {}

  async execute(input: DiffProjectInput): Promise<DiffProjectResult> {
    const { reader, lockStore, core, findHarness } = this.deps;

    const lock = await lockStore.read(input.projectDir);
    // No lock ⇒ nothing is tracked, so there is nothing to compare. Surface an
    // empty result with an empty version rather than throwing — `diff` is a
    // read-only audit, not a precondition-gated mutation.
    if (lock === null) return { results: [], fromVersion: "" };

    const harness = findHarness(lock.harness);
    if (!harness) {
      throw new Error(`unknown harness in lock: ${lock.harness}`);
    }

    const bundle = harness.mapBundle(core, {
      backlogBackend: lock.backlogBackend,
      versionScheme: lock.versionScheme,
      specBackend: lock.specBackend,
      specAutogen: lock.specAutogen,
    });

    const results: DivergenceResult[] = [];
    for (const [dest, entry] of lock.entries) {
      const diskContent = await reader.readText(input.projectDir, dest);
      // A lock entry whose file is gone from disk is outside this view's remit
      // (the divergence is between disk and bundle); skip it rather than invent
      // a result.
      if (diskContent === null) continue;

      const diskSha = await sha256Hex(diskContent);
      const isCustomised = diskSha !== entry.sha256;
      if (input.onlyCustomised && !isCustomised) continue;

      const bundled = bundle[dest];
      if (bundled === undefined) {
        // Tracked on disk but dropped from the new bundle (FR-009).
        results.push({ kind: "missing", dest });
        continue;
      }
      if (bundled.content === diskContent) {
        results.push({ kind: "matches", dest });
      } else {
        results.push({
          kind: "differs",
          dest,
          diskContent,
          bundledContent: bundled.content,
        });
      }
    }

    return { results, fromVersion: lock.templatesVersion };
  }
}
