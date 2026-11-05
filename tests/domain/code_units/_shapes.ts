import { estimateCodeUnits } from "../../../src/domain/code_units/estimate_units.ts";

/** Renders each unit as `kind name @start xlines`, so a fixture's expectation reads as one list. */
export function shapes(path: string, source: string): string[] {
  const estimate = estimateCodeUnits(path, source);
  if (estimate.status !== "analysed") {
    throw new Error(`expected ${path} analysed, got ${estimate.reason}`);
  }
  return estimate.units.map((u) => `${u.kind} ${u.name ?? "?"} @${u.startLine} x${u.lines}`);
}
