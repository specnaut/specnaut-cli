import type {
  ContextLinkWrite,
  FsReader,
  FsWriter,
  Harness,
  LockStore,
  StagingStore,
} from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import type { UpgradePlan } from "../domain/upgrade_plan.ts";
import type { ManagedSectionOutcome } from "./upgrade_managed_sections.ts";
import type { ContextLinkSurvey } from "./upgrade_context_links.ts";

/**
 * Merges this run declined because the host file could not safely take the
 * block — e.g. a `.codex/config.toml` already declaring `[agents]` (cli#599).
 * Carried on every result rather than logged, because a refusal the user never
 * sees is the same as the silent skip it replaced — and on the up-to-date one
 * too, which is the likely path: a project whose only outstanding difference is
 * the refused file lands there. Anything else every path must say joins them:
 * staging cleanup, orphan prunes, and what `carryRenames` moved or would not —
 * the one list a dry run also prints.
 */
type WithRefusals = { refusals: ReadonlyArray<string> };

/** What the JSON re-merge did (`upgrade_json_merges.ts`) on a run that writes. */
type WithMerges = {
  /** What the merges changed that the person should hear about (#642). */
  notes: ReadonlyArray<string>;
  /** JSON-merged dests this run changed. */
  mergedChanged: ReadonlyArray<string>;
};

export type UpToDateResult = WithRefusals & WithMerges & {
  status: "up-to-date";
  currentVersion: string;
};

export type PlannedResult = WithRefusals & {
  status: "planned";
  plan: UpgradePlan;
  fromVersion: string;
  toVersion: string;
  managedSections: ReadonlyArray<ManagedSectionOutcome>;
};

export type AppliedResult = WithRefusals & WithMerges & {
  status: "applied";
  plan: UpgradePlan;
  fromVersion: string;
  toVersion: string;
  backups: ReadonlyArray<string>;
  /** Backups that moved a SYMLINK rather than content (cli#574). */
  linksMoved: ReadonlyArray<string>;
  managedSections: ReadonlyArray<ManagedSectionOutcome>;
  /**
   * Dests whose content this run actually wrote from the bundle.
   *
   * The plan is a forecast, and the report used to render it as the outcome
   * (#519). Under `--force` that is not merely imprecise: every overwritten
   * file was still listed under "customized locally (not touched)", and the
   * files that *did* receive their delayed update were the ones the run
   * warned had missed it. A forecast and a result are different objects, so
   * the result now carries its own.
   */
  written: ReadonlyArray<string>;
  /** The context links this run wrote, and in which form (cli#680). */
  contextLinks: ReadonlyArray<ContextLinkWrite>;
};

export type UpgradeProjectResult = UpToDateResult | PlannedResult | AppliedResult;

/** The ports an upgrade's finishing steps read and write through. */
export type UpgradeIo = {
  readonly reader: FsReader;
  readonly writer: FsWriter;
  readonly lockStore: LockStore;
  readonly stagingStore: StagingStore;
};

/**
 * Everything `UpgradeProjectUseCase.execute` has settled by the time the plan
 * exists: the steps after it — up to date, dry run, apply — read this and
 * return their result, so none of them reaches back into the orchestrator.
 */
export type UpgradeRun = {
  readonly projectDir: string;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly resetBaseline: boolean;
  readonly isDeclaredPreserved: (dest: string) => boolean;
  /** The lock as read: its version is the run's `fromVersion`, its options the rewrite's. */
  readonly lock: InstalledLock;
  /** The parent-managed decision this run persists (009-parent-managed-init). */
  readonly parentManaged: boolean;
  readonly harness: Harness;
  readonly templatesVersion: string;
  /** ISO timestamp for every entry this run (re)installs. */
  readonly now: string;
  /** The user-owned JSON files re-merged outside the plan. */
  readonly jsonMerged: Bundle;
  /** The planned bundle, every refused dest gone. */
  readonly bundle: Bundle;
  /** The lock the plan ran against: refusals dropped, renames carried. */
  readonly effectiveLock: InstalledLock;
  /** dest → lock sha of the bundle's content. */
  readonly newShas: ReadonlyMap<string, string>;
  readonly plan: UpgradePlan;
  /** Everything said before the plan: refusals, the constitution, the renames. */
  readonly refusals: ReadonlyArray<string>;
  readonly links: ContextLinkSurvey;
};
