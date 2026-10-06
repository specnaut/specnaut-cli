// The quota hold: stop the autopilot at a phase boundary rather than let a
// usage limit cut a phase off halfway.
//
// Since the chain stopped asking before it merges and pushes, a limit reached
// mid-run can leave a merge without its push, or a review whose findings were
// never applied. The boundary between two phases is the last clean place to
// stop, so the hold refuses the Skill call that would start the next expensive
// phase, and its reason tells the agent to stop and say so.
//
// Only phases that are expensive or unsafe to cut are guarded: `implement`
// (the bulk of the work), `review` (it dispatches every expert seat) and
// `merge` (a cut there is the one that leaves a half-landed change).

import { longLabel, ordered, untilReset, type Window } from "./usage.ts";
import type { Phase } from "./chain.ts";

export const GUARDED: readonly Phase[] = ["implement", "review", "merge"];

/**
 * Windows the person chose to continue past, by kind, with the reset they
 * were looking at. A hold says once per window; after the person says to go on,
 * it does not say again until that window resets.
 */
export type Lifted = Record<string, string | undefined>;

export type Hold = { window: Window; reason: string };

export function holdFor(
  phase: Phase,
  windows: readonly Window[],
  holdAt: number,
  lifted: Lifted,
  now: number,
): Hold | null {
  if (holdAt >= 100 || !GUARDED.includes(phase)) return null;
  const over = ordered(windows).find((w) =>
    w.percentUsed >= holdAt && !(w.kind in lifted && lifted[w.kind] === w.resetsAt)
  );
  if (!over) return null;
  const eta = untilReset(over.resetsAt, now);
  const pct = Math.round(over.percentUsed);
  return {
    window: over,
    reason: [
      `Specnaut cockpit — quota hold before \`${phase}\`.`,
      `The ${longLabel(over.kind)} usage window is at ${pct}%` +
      (eta ? ` and resets in ${eta}.` : "."),
      `Starting \`${phase}\` now risks the limit cutting it off half-done.`,
      "Stop the chain here. Tell the user it is paused at a clean phase boundary," +
      ` give them the figures above, and say that \`/specnaut ${phase}\` resumes it` +
      (eta ? " after the reset." : " once the window has room."),
      "Do not run the phase's steps by any other means.",
      "If the user tells you to continue anyway, invoke the phase again:" +
      " the hold does not repeat for this window.",
    ].join(" "),
  };
}

/** The person answered a hold: lift it for the windows it was about. */
export function lift(lifted: Lifted, held: readonly Window[]): Lifted {
  const next = { ...lifted };
  for (const w of held) next[w.kind] = w.resetsAt;
  return next;
}
