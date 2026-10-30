import {
  DEFAULT_SIZE_LIMITS,
  isWritableGlob,
  LIMIT_VALUE,
  SIZE_UNITS,
  type SizeLimit,
  sizeLimitsYaml,
  type SizeUnit,
} from "./size_limits.ts";
import { targetSurfaceProblem, uiSettingsYaml } from "./ui_settings.ts";

/**
 * The two framework settings a constitution carried before spec 038 — the
 * `## Size limits` table and the mobile-first `### Target surface`
 * declaration — read out of it so upgrade can write them where they live now
 * (FR-010). Migration code: removed at the next major release (A-L3), with the
 * constitution move.
 *
 * Read in the exact forms the old readers took, so a section they ignored is
 * not resurrected, and every value is checked as the new readers check it
 * (S4): a value they would refuse is refused here, never written.
 */
export type LegacySetting =
  | { readonly kind: "none" }
  | { readonly kind: "extract"; readonly content: string; readonly dropped: readonly string[] }
  | { readonly kind: "refuse"; readonly reason: string };

const NONE: LegacySetting = { kind: "none" };

/** The lines of the section under `heading` (exact, alone on its line), up to the next `## `. */
function section(text: string, heading: RegExp): string[] | null {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The vanilla constitution row older releases shipped: the 60 / 100 default replaces it. */
const VANILLA_CONSTITUTION = "300 500";

const cells = (row: string) =>
  row.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

/**
 * A non-default size table, as `.specnaut/size-limits.yml`. Rows equal to a
 * default — or the old vanilla `| constitution | 300 | 500 |` — are dropped;
 * a table with nothing else is `none`. Units the config does not take
 * (`class`, `component`) are named in `dropped`. A table the old ratchet
 * stopped on — a loose unit name (`File`, `files`), a value that is not a
 * number or `none`, a unit given twice — is refused.
 */
export function extractLegacySizeLimits(constitution: string): LegacySetting {
  const body = section(constitution, /^## Size limits\s*$/);
  if (body === null) return NONE;
  const rows = body.filter((l) => l.startsWith("|"));
  if (rows.length === 0 || !/^unit$/i.test(cells(rows[0])[0] ?? "")) {
    return refuse("it has no `Unit | Target | Ceiling` table");
  }
  const units: Partial<Record<SizeUnit, SizeLimit>> = {};
  const seen = new Set<SizeUnit>();
  const dropped: string[] = [];
  for (const row of rows.slice(1)) {
    const r = judgeRow(row, seen);
    if (r.kind === "refuse") return r;
    if (r.kind === "drop") dropped.push(r.unit);
    if (r.kind === "unit" && r.limit !== null) units[r.unit] = r.limit;
  }
  const exempt = [...(body.find((l) => /^Exempt:/.test(l)) ?? "").matchAll(/`([^`]*)`/g)]
    .map((m) => m[1]);
  const bad = exempt.find((g) => !isWritableGlob(g));
  if (bad !== undefined) return refuse(`the exempt glob '${bad}' cannot be written`);
  if (Object.keys(units).length === 0 && exempt.length === 0) return NONE;
  return { kind: "extract", content: sizeLimitsYaml(units, exempt), dropped };
}

type Refusal = Extract<LegacySetting, { kind: "refuse" }>;
const refuse = (reason: string): Refusal => ({ kind: "refuse", reason });

/** A table row: the separator, a unit the config skips, or a known unit (`null`: a default). */
type Row =
  | { readonly kind: "skip" }
  | { readonly kind: "drop"; readonly unit: string }
  | { readonly kind: "unit"; readonly unit: SizeUnit; readonly limit: SizeLimit | null }
  | Refusal;

/** Judges one row as the old ratchet read it; `seen` is the units already given. */
function judgeRow(row: string, seen: Set<SizeUnit>): Row {
  const [unit, target, ceiling, ...extra] = cells(row);
  if (/^[\s:-]*$/.test(unit)) return { kind: "skip" }; // the separator row
  if (extra.length > 0 || ceiling === undefined) {
    return refuse(`the row '${row.trim()}' is not unit, target, ceiling`);
  }
  const known = SIZE_UNITS.find((u) => u === unit);
  if (known === undefined) {
    return SIZE_UNITS.some((u) => unit.toLowerCase().replace(/s$/, "") === u)
      ? refuse(`the unit '${unit}' is not spelled as the ratchet reads it`)
      : { kind: "drop", unit };
  }
  if (seen.has(known)) return refuse(`the unit '${known}' is given twice`);
  seen.add(known);
  const bad = [target, ceiling].find((v) => !LIMIT_VALUE.test(v));
  if (bad !== undefined) return refuse(`'${known}' has the value '${bad}', not lines or none`);
  const d = DEFAULT_SIZE_LIMITS[known];
  const pair = `${target} ${ceiling}`;
  const isDefault = pair === `${d.target} ${d.ceiling}` ||
    (known === "constitution" && pair === VANILLA_CONSTITUTION);
  const limits = { target: limit(target), ceiling: limit(ceiling) };
  return { kind: "unit", unit: known, limit: isDefault ? null : limits };
}

const limit = (v: string) => v === "none" ? null : Number.parseInt(v, 10);

/**
 * An exact-form target-surface declaration, as `.specnaut/ui.yml`. The form
 * the contract took: under `## Front-end patterns`, a `### Target surface`
 * heading followed by exactly one sentence beginning `This project targets`,
 * and nothing else before the next heading. Anything else was treated as
 * absent — the default stays on — and still is: `none`, never a guess.
 */
export function extractLegacyTargetSurface(constitution: string): LegacySetting {
  const patterns = section(constitution, /^## Front-end patterns\s*$/);
  if (patterns === null) return NONE;
  const start = patterns.findIndex((l) => /^### Target surface\s*$/.test(l));
  if (start === -1) return NONE;
  const rest = patterns.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  if (/\n\s*\n/.test(body)) return NONE;
  const m = /^This project targets\s+([^.!?]+)[.!?]?$/.exec(body.replace(/\s+/g, " "));
  if (m === null) return NONE;
  const surface = m[1].trim();
  const problem = targetSurfaceProblem(surface);
  if (problem !== null) return { kind: "refuse", reason: `the declared surface: ${problem}` };
  return { kind: "extract", content: uiSettingsYaml(surface), dropped: [] };
}
