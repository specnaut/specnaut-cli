import type { FsReader, Harness, LockStore } from "./ports.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import type { Bundle } from "../domain/template.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import { sha256Hex } from "../domain/sha256.ts";
import { classifyLinkDisk, linkOwnership } from "../domain/context_link.ts";
import { gatherLinkEvidence } from "./link_evidence.ts";
import { bundleOptionsOf } from "./upgrade_lock.ts";

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
  /**
   * Restrict the view to a single managed path (project-relative, normalised by
   * the caller). `null` reports every lock-tracked path.
   *
   * A path the lock does not track is NOT silently reported as "no divergence":
   * it comes back as `pathProblem`, because a whole-project answer to a
   * question about one file reads as that file being clean.
   */
  readonly path: string | null;
};

/**
 * Why a scoped request produced nothing, so the caller can say which it was.
 *
 *  - `not-managed`    — the path is not in the lock. A typo, or a file Specnaut
 *    never wrote; either way there is no bundled original to compare against.
 *  - `absent-on-disk` — lock-tracked, but the file is gone. There is a bundled
 *    original and nothing to compare it with.
 */
export type DiffPathProblem = "not-managed" | "absent-on-disk";

export type DiffProjectResult = {
  readonly results: ReadonlyArray<DivergenceResult>;
  /** Installed templates version the bundle was mapped for (lock version). */
  readonly fromVersion: string;
  /**
   * Set only when `input.path` was given and could not be answered. `null` on
   * every whole-project run, and on a scoped run that produced a real verdict.
   */
  readonly pathProblem: DiffPathProblem | null;
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
    const lock = await this.deps.lockStore.read(input.projectDir);
    // No lock ⇒ nothing is tracked, so there is nothing to compare. Surface an
    // empty result with an empty version rather than throwing — `diff` is a
    // read-only audit, not a precondition-gated mutation.
    if (lock === null) {
      return { results: [], fromVersion: "", pathProblem: null };
    }

    // Resolve a scoped request against the lock BEFORE reading anything. A path
    // the lock does not track has no bundled original, so the only honest
    // answer is to name it — running the whole-project view instead is what
    // makes a typo indistinguishable from a clean file.
    const wanted = input.path;
    if (wanted !== null && !lock.entries.has(wanted)) {
      return { results: [], fromVersion: lock.templatesVersion, pathProblem: "not-managed" };
    }
    const bundle = this.bundleFor(lock);
    const results: DivergenceResult[] = [];
    let scopedAbsent = false;
    for (const [dest, entry] of lock.entries) {
      if (wanted !== null && dest !== wanted) continue;
      const verdict = await this.divergence(input.projectDir, bundle, dest, entry);
      // A lock entry whose file is gone from disk is outside this view's remit
      // (the divergence is between disk and bundle); skip it rather than invent
      // a result. When it is the ONE path that was asked about, silence would
      // be read as "clean", so record it and let the caller say so.
      if (verdict === null) {
        if (wanted !== null) scopedAbsent = true;
        continue;
      }
      if (input.onlyCustomised && !verdict.customised) continue;
      results.push(verdict.result);
    }

    return {
      results,
      fromVersion: lock.templatesVersion,
      pathProblem: scopedAbsent ? "absent-on-disk" : null,
    };
  }

  /**
   * The bundle mapped exactly the way `upgrade` maps it, so the comparison is
   * against the same bytes a refresh would write.
   */
  private bundleFor(lock: InstalledLock): Bundle {
    const harness = this.deps.findHarness(lock.harness);
    if (!harness) {
      throw new Error(`unknown harness in lock: ${lock.harness}`);
    }
    return harness.mapBundle(this.deps.core, bundleOptionsOf(lock));
  }

  /** One lock-tracked dest's divergence, or `null` when nothing is on disk there. */
  private async divergence(
    projectDir: string,
    bundle: Bundle,
    dest: string,
    entry: LockEntry,
  ): Promise<Verdict | null> {
    const bundled = bundle[dest];
    if (bundled?.symlinkTo !== undefined) {
      const link = { symlinkTo: bundled.symlinkTo, content: bundled.content };
      return await linkDivergence(this.deps.reader, projectDir, dest, link, entry.sha256);
    }
    const diskContent = await this.deps.reader.readText(projectDir, dest);
    if (diskContent === null) return null;
    const customised = await sha256Hex(diskContent) !== entry.sha256;
    // Tracked on disk but dropped from the new bundle (FR-009).
    if (bundled === undefined) return { result: { kind: "missing", dest }, customised };
    if (bundled.content === diskContent) return { result: { kind: "matches", dest }, customised };
    const result: DivergenceResult = {
      kind: "differs",
      dest,
      diskContent,
      bundledContent: bundled.content,
    };
    return { result, customised };
  }
}

/** A dest's divergence, and whether the maintainer customised it (`onlyCustomised`). */
type Verdict = { result: DivergenceResult; customised: boolean };

/**
 * A context-link destination's divergence (cli#680), judged by what is there
 * rather than by its content: read through the link, `.claude/CLAUDE.md` is
 * `AGENTS.md`, which would render as the whole of AGENTS.md "differing" from a
 * one-line fallback. Our link and our fallback match; anything else differs,
 * shown as what Specnaut would put there.
 */
async function linkDivergence(
  reader: FsReader,
  projectDir: string,
  dest: string,
  file: { readonly symlinkTo: string; readonly content: string },
  lockSha: string,
): Promise<Verdict | null> {
  const ev = await gatherLinkEvidence(reader, projectDir, dest, file.symlinkTo, lockSha);
  const disk = ev.disk;
  if (disk === null) return null;
  const owner = linkOwnership(classifyLinkDisk(dest, file, ev));
  const customised = owner === "theirs";
  if (owner === "ours") return { result: { kind: "matches", dest }, customised };
  const diskContent = disk.kind === "file" ? disk.content : `symlink → ${disk.target}\n`;
  const bundledContent = `symlink → ${file.symlinkTo}\n`;
  return { result: { kind: "differs", dest, diskContent, bundledContent }, customised };
}
