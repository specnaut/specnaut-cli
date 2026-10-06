// One toast per threshold per window — not one per turn.
//
// `session.measure` fires after every turn and whenever a window moves a whole
// point, so a window sitting at 84% would toast on every one of them. The memo
// records, per window kind, the highest threshold already announced and the
// reset it was announced for; a new reset (a new window) starts it over.

import { longLabel, untilReset, type Window } from "./usage.ts";

export type AlertMemo = Record<string, { resetsAt?: string; announced: number }>;

export function alertsFor(
  windows: readonly Window[],
  memo: AlertMemo,
  thresholds: readonly number[],
  now: number,
): { toasts: string[]; memo: AlertMemo } {
  const steps = [...new Set(thresholds)].filter((t) => t > 0 && t <= 100).sort((a, b) => a - b);
  const next: AlertMemo = { ...memo };
  const toasts: string[] = [];
  for (const w of windows) {
    const prior = next[w.kind];
    const announced = prior && prior.resetsAt === w.resetsAt ? prior.announced : 0;
    const crossed = steps.filter((t) => w.percentUsed >= t).at(-1);
    if (crossed !== undefined && crossed > announced) {
      const eta = untilReset(w.resetsAt, now);
      toasts.push(
        `${longLabel(w.kind)} usage window at ${Math.round(w.percentUsed)}%` +
          (eta ? ` — resets in ${eta}` : ""),
      );
      next[w.kind] = { resetsAt: w.resetsAt, announced: crossed };
    } else {
      next[w.kind] = { resetsAt: w.resetsAt, announced };
    }
  }
  return { toasts, memo: next };
}
