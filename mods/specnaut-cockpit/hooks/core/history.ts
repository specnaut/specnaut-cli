// Usage over time: per local day and per git branch.
//
// The rate-limit windows are rolling and carry no daily figure, and the session
// cost starts over with every session. So the cockpit keeps its own ledger:
// each increase of a session's cost is added to the day it happened on and to
// the branch that was checked out, and each day keeps the highest reading of
// every window. It lives in the mod's persistent store, on this machine only.

import type { Window } from "./usage.ts";

export type DayStat = {
  costUsd: number;
  /** Highest `percentUsed` seen that day, per window kind. */
  peak: Record<string, number>;
};

export type BranchStat = {
  /** `<repo> · <branch>`, for display. */
  label: string;
  costUsd: number;
  /** The last day a cost was recorded against it. */
  lastDay: string;
};

export type History = {
  v: 1;
  days: Record<string, DayStat>;
  branches: Record<string, BranchStat>;
};

export const RETENTION_DAYS = 90;

export function emptyHistory(): History {
  return { v: 1, days: {}, branches: {} };
}

/** A stored value read back: anything not shaped like a History is a fresh one. */
export function asHistory(raw: unknown): History {
  const h = raw as Partial<History> | null | undefined;
  if (!h || h.v !== 1 || typeof h.days !== "object" || typeof h.branches !== "object") {
    return emptyHistory();
  }
  return { v: 1, days: { ...h.days }, branches: { ...h.branches } };
}

/** `YYYY-MM-DD` of `now` at a UTC offset of `offsetMinutes` (east positive). */
export function localDay(now: number, offsetMinutes: number): string {
  return new Date(now + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How much a session's running cost grew since `seen`. A total below `seen`
 * means the session's ledger started over (`/clear`), and everything in it is
 * new; a non-finite total adds nothing.
 */
export function costDelta(seen: number, total: number | undefined): number {
  if (total === undefined || !Number.isFinite(total)) return 0;
  return total >= seen ? total - seen : total;
}

export type Sample = {
  day: string;
  /** How much the session's cost grew since the last sample. */
  costDelta: number;
  windows: readonly Window[];
  branch?: { key: string; label: string };
};

export function record(h: History, s: Sample): History {
  const days = { ...h.days };
  const prior = days[s.day] ?? { costUsd: 0, peak: {} };
  const peak = { ...prior.peak };
  for (const w of s.windows) peak[w.kind] = Math.max(peak[w.kind] ?? 0, w.percentUsed);
  const delta = Number.isFinite(s.costDelta) && s.costDelta > 0 ? s.costDelta : 0;
  days[s.day] = { costUsd: prior.costUsd + delta, peak };

  const branches = { ...h.branches };
  if (s.branch && delta > 0) {
    const b = branches[s.branch.key];
    branches[s.branch.key] = {
      label: s.branch.label,
      costUsd: (b?.costUsd ?? 0) + delta,
      lastDay: s.day,
    };
  }
  return { v: 1, days, branches };
}

/** Drop days and branches older than `keep` days before `today`. */
export function prune(h: History, today: string, keep = RETENTION_DAYS): History {
  const oldest = addDays(today, -(keep - 1));
  const days = Object.fromEntries(Object.entries(h.days).filter(([d]) => d >= oldest));
  const branches = Object.fromEntries(
    Object.entries(h.branches).filter(([, b]) => b.lastDay >= oldest),
  );
  return { v: 1, days, branches };
}

/** The last `n` days ending today, oldest first, empty days included. */
export function lastDays(h: History, today: string, n = 7): ({ day: string } & DayStat)[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1));
    return { day, ...(h.days[day] ?? { costUsd: 0, peak: {} }) };
  });
}

/** The costliest branches with a cost in the last `n` days. */
export function topBranches(h: History, today: string, n = 5, sinceDays = 7): BranchStat[] {
  const oldest = addDays(today, -(sinceDays - 1));
  return Object.values(h.branches)
    .filter((b) => b.lastDay >= oldest)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, n);
}
