import { estimateCodeUnits, type UnitEstimate } from "../domain/code_units/estimate_units.ts";
import { classifyPath } from "../domain/code_units/language_table.ts";
import { SIZE_LIMITS_CONFIG_PATH } from "../domain/constitution_paths.ts";
import {
  binaryByAttribute,
  exemptGlobsProblem,
  type ExemptRules,
  exemptRules,
  heldBy,
} from "../domain/size_exempt.ts";
import { ScanFold } from "../domain/structural_scan.ts";
import type { ScanReport } from "../domain/structural_scan_types.ts";
import {
  type FileRead,
  LOCK_PATH,
  type ScanRepository,
  type TrackedEntry,
} from "./structural_scan_ports.ts";

/** `top` null is `--top all`. `path` is a validated, repository-relative subtree. */
export type ScanInput = { readonly path: string | null; readonly top: number | null };

/** A map, or why there is none. The exit code each maps to is the handler's (plan A9). */
export type ScanOutcome =
  | { readonly kind: "report"; readonly report: ScanReport }
  | { readonly kind: "no_match" }
  | { readonly kind: "unreadable"; readonly what: string; readonly reason: string };

/** How many files are read at once (plan P3): memory stays within this times the read cap. */
const READ_POOL = 16;

/**
 * The scan: limits and exemptions first, then the listing, then every candidate read once and
 * folded at once. An exempt path is never opened (FR-004), and a `--path` that names nothing is
 * its own outcome, never "0 files" (FR-007).
 */
export async function runStructuralScan(
  repo: ScanRepository,
  input: ScanInput,
): Promise<ScanOutcome> {
  const config = await repo.sizeConfig();
  if (config.kind === "unreadable") return unreadable(SIZE_LIMITS_CONFIG_PATH, config.reason);
  const globs = exemptGlobsProblem(config.limits.exempt);
  if (globs !== null) return unreadable(SIZE_LIMITS_CONFIG_PATH, globs);
  const lock = await repo.lockEntries();
  if (lock.kind === "unreadable") return unreadable(LOCK_PATH, lock.reason);
  const listing = await repo.listTracked(input.path);
  const tracked = listing.entries.length + listing.undecodable;
  if (input.path !== null && tracked === 0) return { kind: "no_match" };
  const fold = new ScanFold(config.limits.units, input.top, input.path, tracked);
  for (let i = 0; i < listing.undecodable; i++) fold.skipped("undecodable_name");
  const rules = exemptRules(lock.paths, config.limits.exempt);
  await measureAll(repo, held(listing.entries, rules, fold), fold);
  return { kind: "report", report: fold.report() };
}

function unreadable(what: string, reason: string): ScanOutcome {
  return { kind: "unreadable", what, reason };
}

type Candidate = { readonly path: string; readonly unit: "file" | "constitution" };

/** Each entry's rule; the exempt and the index's links and submodules folded, never opened. */
function held(entries: readonly TrackedEntry[], rules: ExemptRules, fold: ScanFold): Candidate[] {
  const candidates: Candidate[] = [];
  for (const { path, mode } of entries) {
    const rule = heldBy(path, rules);
    if (rule.kind === "exempt") fold.exempt(rule.reason);
    else if (mode !== "file") fold.skipped(mode);
    else candidates.push({ path, unit: rule.unit });
  }
  return candidates;
}

/** The `-diff` files folded as binary unopened; every other candidate read through the pool. */
async function measureAll(repo: ScanRepository, candidates: Candidate[], fold: ScanFold) {
  const attributes = await repo.diffAttributes(candidates.map((c) => c.path));
  const reads: { candidate: Candidate; sniff: boolean }[] = [];
  for (const candidate of candidates) {
    const binary = binaryByAttribute(attributes.get(candidate.path) ?? "unspecified");
    if (binary === true) fold.exempt("binary");
    else reads.push({ candidate, sniff: binary === null });
  }
  await eachPooled(reads, READ_POOL, async ({ candidate, sniff }) => {
    const decode = classifyPath(candidate.path).kind === "read";
    foldRead(fold, candidate, await repo.read(candidate.path, { sniff, decode }));
  });
}

/** One read folded, synchronously after its `await`, so nothing but the fold outlives it (P5). */
function foldRead(fold: ScanFold, { path, unit }: Candidate, read: FileRead): void {
  if (read.kind === "missing") fold.missing();
  else if (read.kind === "skipped") fold.skipped(read.reason);
  else if (read.kind === "binary") fold.exempt("binary");
  else fold.measured({ path, unit, lines: read.lines, estimate: estimateOf(path, read.text) });
}

/** The estimate, or why there is none: the language first, so prose over the cap is still prose. */
function estimateOf(path: string, text: string | null): UnitEstimate {
  const c = classifyPath(path);
  if (c.kind !== "read") return { status: "not_analysed", reason: c.kind };
  return text === null
    ? { status: "not_analysed", reason: "too_large" }
    : estimateCodeUnits(path, text);
}

/** `work` over `items`, `width` at a time. */
async function eachPooled<T>(items: readonly T[], width: number, work: (t: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}
