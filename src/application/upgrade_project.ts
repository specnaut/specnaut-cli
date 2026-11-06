import type { FsReader, Harness, LockStore, PluginDetector, StagingStore } from "./ports.ts";
import type { FsWriter } from "./ports.ts";
import { type Bundle, lockShaInput } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { computeUpgradePlan, type UpgradePlan } from "../domain/upgrade_plan.ts";
import { isPluginCoveredPath, PLUGIN_NAME, pluginRelativePath } from "../domain/plugin_coverage.ts";
import { isAgenticPath } from "../domain/parent_managed.ts";
import { bundleOptionsOf } from "./lock_bundle.ts";
import { type ManagedSectionOutcome, surveyManagedSections } from "./upgrade_managed_sections.ts";
import { carryRenames } from "./upgrade_renames.ts";
import { gatherPlanInputs } from "./upgrade_plan_inputs.ts";
import { splitJsonMerged } from "./upgrade_json_merges.ts";
import type { ContextLinkSurvey } from "./upgrade_context_links.ts";
import { finishUpToDate } from "./upgrade_up_to_date.ts";
import { applyUpgrade } from "./upgrade_apply.ts";
import type { UpgradeIo, UpgradeProjectResult, UpgradeRun } from "./upgrade_run.ts";

export type { ManagedSectionOutcome, UpgradeProjectResult };

export type UpgradeProjectInput = {
  projectDir: string;
  dryRun: boolean;
  force: boolean;
  /**
   * `--reset-baseline` flag. Heals stale lock SHAs left by older binaries
   * (and any other source of disk/lock divergence) by trusting the
   * on-disk content as the new baseline. Existing files where
   * `diskSha != lockSha` get their lock SHA force-reset; the plan then
   * compares disk vs bundle directly. Use after the user confirms they
   * never edited the affected files.
   */
  resetBaseline?: boolean;
  /**
   * Parent-managed decision re-derived by the handler when the lock predates
   * the `parent_managed` field (009-parent-managed-init). When provided it
   * takes precedence over `lock.parentManaged`, and the value is persisted into
   * the rewritten lock so subsequent upgrades read it directly. Absent ⇒ the
   * decision is read from `lock.parentManaged` (already cached) or treated as
   * `false`.
   */
  parentManagedOverride?: boolean;
  /**
   * Declared-preserve predicate (spec 011 / issue #367). Returns true for any
   * dest the maintainer listed in `.specnaut/preserve.yml`. Threaded straight
   * into `computeUpgradePlan` so declared files become `preserve/"declared"`
   * (winning over auto-update, plugin-migration, and removal). Built by the
   * handler from the manifest (and flipped off when `--reset-preserved` is
   * passed); the use case never reads the manifest or any CLI flag. Absent ⇒
   * no declared preserves (today's behaviour).
   */
  isDeclaredPreserved?: (dest: string) => boolean;
};

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  /**
   * `.specnaut/upgrade-staging/`. Required, not optional like the plugin probe:
   * an upgrade that cannot see the staging tree cannot prune it, and a prune
   * that silently does not happen is the #613 bug itself.
   */
  stagingStore: StagingStore;
  core: CoreBundle;
  templatesVersion: string;
  findHarness: (key: string) => Harness | null;
  /**
   * Optional plugin probe. Drives the binary → plugin migration table —
   * when the plugin is installed and the harness is `claude`, vanilla
   * on-disk agent / skill files are auto-migrated (backed up + deleted;
   * plugin serves them going forward) and customized files are
   * preserved with a "plugin available" warning. Tests omit this dep
   * to skip migration entirely.
   */
  pluginDetector?: PluginDetector;
  now?: () => Date;
};

export class UpgradeProjectUseCase {
  constructor(private readonly deps: UpgradeProjectDeps) {}

  /**
   * One upgrade, as named steps: read the lock, scope the bundle, gather what
   * the plan reads (every refusal on the way), carry renames, plan, then
   * finish — up to date, dry run, or apply. Each step returns what the next
   * one reads; none writes into another's state.
   */
  async execute(input: UpgradeProjectInput): Promise<UpgradeProjectResult> {
    const { reader, writer, core, templatesVersion } = this.deps;
    const { lock, harness } = await this.readLock(input.projectDir);
    const parentManaged = input.parentManagedOverride ?? lock.parentManaged ?? false;
    const mapped = harness.mapBundle(core, bundleOptionsOf(lock));
    // JSON-merged files are user-owned and live outside the lock-tracked plan.
    const { jsonMerged, planned } = splitJsonMerged(ownedBundle(mapped, parentManaged));
    const isDeclaredPreserved = input.isDeclaredPreserved ?? (() => false);
    const io = { reader, writer, dryRun: input.dryRun };
    const inputs = await gatherPlanInputs(io, input.projectDir, planned, lock, isDeclaredPreserved);
    // Renamed docs, then the addenda of moved phases; what it did or refused is said.
    const carried = await carryRenames(
      { ...input, reader, writer, harness, bundleOpts: bundleOptionsOf(lock) },
      inputs.bundle,
      inputs.lockForPlan,
      inputs.diskShas,
    );
    const step = { ...inputs, ...carried, harness, input, isDeclaredPreserved };
    const { plan, newShas } = await this.plan(step);
    const run: UpgradeRun = {
      ...input,
      resetBaseline: input.resetBaseline ?? false,
      isDeclaredPreserved,
      lock,
      parentManaged,
      harness,
      templatesVersion,
      now: (this.deps.now ?? (() => new Date()))().toISOString(),
      jsonMerged,
      bundle: inputs.bundle,
      effectiveLock: carried.lock,
      newShas,
      plan,
      refusals: [...inputs.refusals, ...carried.notes],
      links: inputs.links,
    };
    return await this.finish(run);
  }

  /** The lock, and the harness it names; an upgrade has nothing to plan against without both. */
  private async readLock(projectDir: string): Promise<{ lock: InstalledLock; harness: Harness }> {
    const lock = await this.deps.lockStore.read(projectDir);
    if (lock === null) {
      throw new Error(
        "no .specnaut/installed.lock found. Run `specnaut init --here --force` to enable upgrades.",
      );
    }
    const harness = this.deps.findHarness(lock.harness);
    if (!harness) {
      throw new Error(`unknown harness in lock: ${lock.harness}`);
    }
    return { lock, harness };
  }

  /**
   * The plan, and the bundle shas it compared. The plugin is asked what it
   * serves here rather than inside `computeUpgradePlan`, because the plan is a
   * pure synchronous function and that question is a filesystem probe.
   */
  private async plan(step: PlanStep): Promise<{ plan: UpgradePlan; newShas: Map<string, string> }> {
    const { bundle, input } = step;
    const newShas = new Map<string, string>();
    for (const [dest, file] of Object.entries(bundle)) {
      newShas.set(dest, await sha256Hex(lockShaInput(file)));
    }
    const plugin = await this.pluginServes(step.lock.harness, newShas.keys());
    const plan = computeUpgradePlan(step.diskShas, step.lock, newShas, {
      pluginInstalled: plugin.installed,
      isPluginCovered: (dest) => plugin.served.has(dest),
      isSkipIfExists: (dest) => bundle[dest]?.skipIfExists === true,
      resetBaseline: input.resetBaseline ?? false,
      isDeclaredPreserved: step.isDeclaredPreserved,
      managedRoots: step.harness.managedRoots,
      managedFiles: step.harness.managedFiles,
      linkStates: step.links.states,
    });
    return { plan, newShas };
  }

  /**
   * Whether the plugin is installed, and which covered dests the INSTALLED
   * plugin actually serves — not the compile-time coverage list on its own
   * (cli#606).
   *
   * `PLUGIN_COVERED_PATHS_CLAUDE` describes what the plugin is expected to
   * ship. A user on an older plugin release has covered paths their build has
   * never heard of — and migrating one deletes the project's only copy while
   * nothing takes over serving it. The list says "the plugin owns this path";
   * only the tree can say "this install has it". The probe runs only when the
   * plugin is installed: on every other run the answer cannot change the
   * outcome, so it is not worth a single stat.
   */
  private async pluginServes(
    harnessKey: InstalledLock["harness"],
    dests: Iterable<string>,
  ): Promise<{ installed: boolean; served: Set<string> }> {
    const detector = this.deps.pluginDetector;
    const served = new Set<string>();
    if (detector === undefined || !await detector.isPluginInstalled(PLUGIN_NAME)) {
      return { installed: false, served };
    }
    for (const dest of dests) {
      if (!isPluginCoveredPath(harnessKey, dest)) continue;
      const rel = pluginRelativePath(dest);
      if (rel === null) continue;
      if (await detector.pluginHasPath(PLUGIN_NAME, rel)) served.add(dest);
    }
    return { installed: true, served };
  }

  /**
   * The three ways a planned run ends. Managed sections — Specnaut's blocks
   * inside files the user owns (#466) — live outside the plan on purpose:
   * `AGENTS.md` is `skipIfExists`, so an upgrade never writes it, which is
   * right for the file and wrong for the one section that has to reach a
   * project that upgrades rather than inits. So they count as work here.
   *
   * `--dry-run` returns BEFORE anything is written. It used to fall through
   * the staging block on the argument that an agent could then preview the
   * reconciliation plan — but a preview that leaves several dozen files on
   * disk is not a preview, and it primed `specnaut reconcile` with upstream
   * content for an upgrade that was never applied. The plan already names
   * every customized dest, which is what a preview owes the caller.
   */
  private async finish(run: UpgradeRun): Promise<UpgradeProjectResult> {
    const io: UpgradeIo = this.deps;
    const sections = await surveyManagedSections(
      io.reader,
      run.bundle,
      run.projectDir,
      run.isDeclaredPreserved,
    );
    if (sections.length === 0 && run.plan.every((a) => a.kind === "unchanged")) {
      return await finishUpToDate(io, run);
    }
    if (!run.dryRun) return await applyUpgrade(io, run);
    return {
      status: "planned",
      refusals: run.refusals,
      plan: run.plan,
      fromVersion: run.lock.templatesVersion,
      toVersion: run.templatesVersion,
      managedSections: sections,
    };
  }
}

/** What `plan` reads: the gathered inputs with the renames carried. */
type PlanStep = {
  readonly bundle: Bundle;
  readonly diskShas: ReadonlyMap<string, string>;
  /** The lock the plan runs against — refusals dropped, renames carried. */
  readonly lock: InstalledLock;
  readonly links: ContextLinkSurvey;
  readonly harness: Harness;
  readonly input: UpgradeProjectInput;
  readonly isDeclaredPreserved: (dest: string) => boolean;
};

/**
 * The bundle this workspace owns. A parent-managed target inherits its agentic
 * files from the providing workspace, so those dests leave the bundle *before*
 * the plan is computed: a suppressed path is never planned, written, or
 * "restored" (FR-007).
 */
function ownedBundle(mapped: Bundle, parentManaged: boolean): Bundle {
  if (!parentManaged) return mapped;
  return Object.fromEntries(Object.entries(mapped).filter(([dest]) => !isAgenticPath(dest)));
}
