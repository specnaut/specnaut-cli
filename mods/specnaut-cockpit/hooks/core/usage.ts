// The cockpit's reading of the session: rate-limit windows, context fill and
// cost, and how each is put into words. Pure — no engine, no clock, no I/O —
// so the hooks module stays wiring and this stays testable under `deno test`.

/** One rate-limit window as the engine reports it. */
export type Window = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string;
  /** 0 to 100, past 100 on an exceeded spend limit. */
  percentUsed: number;
  /** ISO 8601. */
  resetsAt?: string;
};

/** What the band and the pane draw from: the last measurement. */
export type Reading = {
  windows: Window[];
  /** Context fill, 0 to 100, once a response reported one. */
  contextPercent?: number;
  /** The session's cost so far, in US dollars. */
  costUsd?: number;
};

export type Tone = "normal" | "warn" | "alert";

/** The cockpit's two thresholds, both percentages of a window. */
export type Thresholds = {
  /** A window at or above this is shown in the warning colour and toasted. */
  warnAt: number;
  /** A window at or above this holds the autopilot. 100 turns the hold off. */
  holdAt: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = { warnAt: 80, holdAt: 90 };

/**
 * The thresholds from the plugin's options, held to the bounds plugin.json
 * declares (hold 50–100, warn 10–100): a stored value outside them is
 * clamped, a missing or non-numeric one takes the default.
 */
export function thresholdsFrom(options: Record<string, unknown> | undefined): Thresholds {
  const n = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    warnAt: n(options?.warn_at, DEFAULT_THRESHOLDS.warnAt, 10, 100),
    holdAt: n(options?.hold_at, DEFAULT_THRESHOLDS.holdAt, 50, 100),
  };
}

const LABELS: Record<string, { short: string; long: string }> = {
  five_hour: { short: "5h", long: "5-hour" },
  seven_day: { short: "7d", long: "weekly" },
  spend_limit: { short: "spend", long: "spend-limit" },
};

/** `5h`, `7d`, `spend`, or the kind itself for one this build does not know. */
export function shortLabel(kind: string): string {
  return LABELS[kind]?.short ?? kind;
}

/** `5-hour`, `weekly`, `spend-limit` — for sentences. */
export function longLabel(kind: string): string {
  return LABELS[kind]?.long ?? kind.replaceAll("_", " ");
}

/** The windows in a stable order: 5h, 7d, spend, then the rest by name. */
export function ordered(windows: readonly Window[]): Window[] {
  const rank = (k: string) => {
    const i = Object.keys(LABELS).indexOf(k);
    return i === -1 ? Object.keys(LABELS).length : i;
  };
  return [...windows].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind));
}

export function toneOf(percent: number, t: Thresholds): Tone {
  if (t.holdAt < 100 && percent >= t.holdAt) return "alert";
  if (percent >= t.warnAt) return "warn";
  return "normal";
}

/**
 * Time until `resetsAt`, coarse enough to read at a glance: `45m`, `2h10`,
 * `3d4h`, `<1m`. Relative on purpose — it needs no time zone, and "how long do
 * I wait" is the question a reset time answers. Undefined when unknown or
 * unparseable; `<1m` once it has passed (the next reading will move it).
 */
export function untilReset(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined;
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return undefined;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d${restHours}h`;
}

/** `$0.04`, `$3.12`, `$124` — cents until the figure is large enough to drop them. */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$0";
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/** A whole or one-decimal percentage as the engine gives it: `62%`, `23.5%`. */
export function formatPercent(p: number): string {
  return `${Math.round(p * 10) / 10}%`;
}
