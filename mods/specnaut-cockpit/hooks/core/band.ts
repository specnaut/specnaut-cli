// The band above the prompt, as segments of text and tone, sized to its width.
//
// It is built in decreasing detail and the first form that fits wins, so a
// narrow terminal loses the reset times and the chain's detail before it loses
// a limit: the windows are the reason the band exists.

import { chainLine, chainShort, type ChainState } from "./chain.ts";
import {
  formatCost,
  formatPercent,
  ordered,
  type Reading,
  shortLabel,
  type Thresholds,
  type Tone,
  toneOf,
  untilReset,
} from "./usage.ts";

export type Segment = { text: string; tone: Tone | "dim" };

type Detail = {
  resets: boolean;
  context: boolean;
  cost: boolean;
  chain: "full" | "short" | "none";
};

const FORMS: Detail[] = [
  { resets: true, context: true, cost: true, chain: "full" },
  { resets: true, context: true, cost: true, chain: "short" },
  { resets: false, context: true, cost: true, chain: "short" },
  { resets: false, context: false, cost: false, chain: "short" },
  { resets: false, context: false, cost: false, chain: "none" },
];

const SEP: Segment = { text: " · ", tone: "dim" };

function build(r: Reading | null, chain: ChainState, t: Thresholds, now: number, d: Detail) {
  const groups: Segment[][] = [];
  for (const w of ordered(r?.windows ?? [])) {
    const eta = d.resets ? untilReset(w.resetsAt, now) : undefined;
    groups.push([
      { text: `${shortLabel(w.kind)} `, tone: "dim" },
      { text: formatPercent(w.percentUsed), tone: toneOf(w.percentUsed, t) },
      ...(eta ? [{ text: ` ↻${eta}`, tone: "dim" as const }] : []),
    ]);
  }
  if (d.context && r?.contextPercent !== undefined) {
    groups.push([
      { text: "ctx ", tone: "dim" },
      { text: formatPercent(r.contextPercent), tone: r.contextPercent >= 85 ? "warn" : "normal" },
    ]);
  }
  if (d.cost && r?.costUsd !== undefined) {
    groups.push([{ text: formatCost(r.costUsd), tone: "normal" }]);
  }
  const line = d.chain === "full" ? chainLine(chain) : d.chain === "short" ? chainShort(chain) : "";
  if (line) groups.push([{ text: `▸ ${line}`, tone: "normal" }]);
  return groups.flatMap((g, i) => (i === 0 ? g : [SEP, ...g]));
}

export function width(segments: readonly Segment[]): number {
  return segments.reduce((n, s) => n + [...s.text].length, 0);
}

/** The most detailed form that fits in `columns`; [] when there is nothing to show. */
export function bandSegments(
  r: Reading | null,
  chain: ChainState,
  t: Thresholds,
  columns: number,
  now: number,
): Segment[] {
  let last: Segment[] = [];
  for (const d of FORMS) {
    last = build(r, chain, t, now, d);
    if (width(last) <= columns) return last;
  }
  return last;
}
