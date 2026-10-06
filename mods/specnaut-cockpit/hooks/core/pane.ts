// The `/cockpit` pane: limits, this session, the last seven days, and the
// branches that cost the most. Rows of segments, so the hooks module only maps
// them to elements.

import type { Segment } from "./band.ts";
import { chainLine, type ChainState } from "./chain.ts";
import { type History, lastDays, topBranches } from "./history.ts";
import {
  formatCost,
  formatPercent,
  longLabel,
  ordered,
  type Reading,
  type Thresholds,
  toneOf,
  untilReset,
} from "./usage.ts";

export type Row = Segment[];

const BAR = 10;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR, Math.round((percent / 100) * BAR)));
  return "█".repeat(filled) + "░".repeat(BAR - filled);
}

function heading(text: string): Row {
  return [{ text, tone: "normal" }];
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${day.slice(8)}`;
}

export function paneRows(input: {
  reading: Reading | null;
  chain: ChainState;
  history: History;
  today: string;
  thresholds: Thresholds;
  now: number;
}): Row[] {
  const { reading, chain, history, today, thresholds: t, now } = input;
  const rows: Row[] = [heading("Limits")];
  const windows = ordered(reading?.windows ?? []);
  if (windows.length === 0) {
    rows.push([{
      text:
        "  No rate-limit reading yet — it arrives with the first response on a plan with limits.",
      tone: "dim",
    }]);
  }
  for (const w of windows) {
    const eta = untilReset(w.resetsAt, now);
    rows.push([
      { text: `  ${longLabel(w.kind).padEnd(12)}`, tone: "dim" },
      {
        text: `${bar(w.percentUsed)} ${formatPercent(w.percentUsed).padStart(6)}`,
        tone: toneOf(w.percentUsed, t),
      },
      { text: eta ? `  resets in ${eta}` : "", tone: "dim" },
    ]);
  }
  rows.push(
    [{
      text: t.holdAt >= 100
        ? "  The quota hold is off."
        : `  The autopilot holds before implement, review and merge at ${t.holdAt}%.`,
      tone: "dim",
    }],
    [],
    heading("This session"),
  );
  const parts = [
    reading?.contextPercent !== undefined ? `context ${formatPercent(reading.contextPercent)}` : "",
    reading?.costUsd !== undefined ? `cost ${formatCost(reading.costUsd)}` : "",
  ].filter(Boolean);
  rows.push([{ text: `  ${parts.join(" · ") || "nothing measured yet"}`, tone: "normal" }]);
  const line = chainLine(chain);
  if (line) rows.push([{ text: `  chain  ${line}`, tone: "normal" }]);

  rows.push([], heading("Last 7 days"));
  const days = lastDays(history, today);
  for (const d of days) {
    const peak = d.peak.five_hour;
    rows.push([
      { text: `  ${dayLabel(d.day)}${d.day === today ? " (today)" : ""}`.padEnd(18), tone: "dim" },
      { text: formatCost(d.costUsd).padStart(8), tone: "normal" },
      { text: peak !== undefined ? `   peak 5h ${formatPercent(peak)}` : "", tone: "dim" },
    ]);
  }
  rows.push([
    { text: "  total".padEnd(18), tone: "dim" },
    { text: formatCost(days.reduce((n, d) => n + d.costUsd, 0)).padStart(8), tone: "normal" },
  ]);

  const branches = topBranches(history, today);
  if (branches.length > 0) {
    rows.push([], heading("Branches, last 7 days"));
    for (const b of branches) {
      rows.push([
        { text: formatCost(b.costUsd).padStart(10), tone: "normal" },
        { text: `  ${b.label}`, tone: "dim" },
      ]);
    }
  }
  rows.push([], [{
    text: "Kept on this machine only. /cockpit hide · /cockpit show",
    tone: "dim",
  }]);
  return rows;
}
