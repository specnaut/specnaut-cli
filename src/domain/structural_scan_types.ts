import type { Ranked } from "./bounded_top.ts";
import {
  type CodeUnit,
  NOT_ANALYSED_REASONS,
  type NotAnalysedReason,
  type UnitEstimate,
} from "./code_units/estimate_units.ts";
import { EXEMPT_REASONS, type ExemptReason } from "./size_exempt.ts";
import { type ResolvedLimit, SIZE_UNITS, type SizeUnit } from "./size_limits.ts";

/**
 * The value objects of the structural scan (plan § 6): shapes and vocabularies only. What they
 * hold, and how they are ranked and cut, is decided in `structural_scan.ts`.
 */

export type { Ranked } from "./bounded_top.ts";

/** Why a tracked path was never opened, or could not be read. */
// deno-fmt-ignore
export const SKIP_REASONS = [
  "symlink", "submodule", "link_ancestor", "not_regular", "undecodable_name", "unreadable",
  "outside_root",
] as const;
export type SkipReason = typeof SKIP_REASONS[number];

export type Level = "over_target" | "over_ceiling";
const LEVELS: readonly Level[] = ["over_target", "over_ceiling"];

/** A measure held to a limit: which one it crossed, and where that limit comes from (FR-003). */
export type Judged = {
  readonly level: Level;
  readonly limit: number;
  readonly source: ResolvedLimit["source"];
};

export type FileFinding = Judged & {
  readonly kind: "file";
  readonly path: string;
  readonly unit: "file" | "constitution";
  readonly lines: number;
};

/** Estimated, always: a unit over its limit is reported and never decides the exit code. */
export type UnitFinding = Judged & Omit<CodeUnit, "kind"> & { readonly kind: "function" | "class" };

/** A folder's own files: measured files only, never what lies in its subfolders. */
export type FolderMeasure = {
  readonly kind: "folder";
  readonly path: string;
  readonly files: number;
  readonly lines: number;
};

/** A folder of the tree, with everything under it. */
export type TreeNode = Omit<FolderMeasure, "kind"> & { readonly depth: number };

export type HotSpot = FileFinding | UnitFinding | FolderMeasure;

export type Count<K extends string> = Record<K, number>;

/** Every tracked path in exactly one disposition: measured, exempt, skipped or missing (FR-002). */
export type ScanTotals = {
  tracked: number;
  measured: number;
  exempt: number;
  skipped: number;
  missing: number;
  lines: number;
  exemptBy: Count<ExemptReason>;
  skippedBy: Count<SkipReason>;
  /** Measured text, the second axis: analysed, or not analysed by reason. */
  analysed: number;
  notAnalysedBy: Count<NotAnalysedReason>;
  units: { functions: number; classes: number; unnamed: number };
  over: Record<SizeUnit, Count<Level>>;
};

export type ScanReport = {
  readonly statements: { readonly map: string; readonly data: string };
  readonly path: string | null;
  readonly limits: Readonly<Record<SizeUnit, ResolvedLimit>>;
  readonly totals: ScanTotals;
  readonly hotSpots: Ranked<HotSpot>;
  readonly files: Ranked<FileFinding>;
  readonly functions: Ranked<UnitFinding>;
  readonly classes: Ranked<UnitFinding>;
  readonly foldersByFiles: Ranked<FolderMeasure>;
  readonly foldersByLines: Ranked<FolderMeasure>;
  readonly tree: Ranked<TreeNode>;
};

/** A measured file: its path, the unit it is held to, its lines and what the estimator found. */
export type Measured = {
  readonly path: string;
  readonly unit: "file" | "constitution";
  readonly lines: number;
  readonly estimate: UnitEstimate;
};

const zeroCounts = <K extends string>(keys: readonly K[]): Count<K> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Count<K>;

/** Every counter at zero, before the first file is folded. */
export function emptyTotals(tracked: number): ScanTotals {
  return {
    tracked,
    measured: 0,
    exempt: 0,
    skipped: 0,
    missing: 0,
    lines: 0,
    analysed: 0,
    exemptBy: zeroCounts(EXEMPT_REASONS),
    skippedBy: zeroCounts(SKIP_REASONS),
    notAnalysedBy: zeroCounts(NOT_ANALYSED_REASONS),
    units: { functions: 0, classes: 0, unnamed: 0 },
    over: Object.fromEntries(SIZE_UNITS.map((u) => [u, zeroCounts(LEVELS)])) as ScanTotals["over"],
  };
}
