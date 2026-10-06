// The cockpit's session state, as Claude Code requires it: self-contained.
// The shapes mirror ./hooks/core/ (Window, Reading, ChainState, AlertMemo,
// Lifted); `tsc -p` over the mod holds the two together, because the hooks
// module writes core values into these slots.

export type CockpitWindow = { kind: string; percentUsed: number; resetsAt?: string };

export type CockpitReading = {
  windows: CockpitWindow[];
  contextPercent?: number;
  costUsd?: number;
};

export type CockpitChain = {
  current: "plan" | "tasks" | "implement" | "review" | "merge" | null;
  finished: boolean;
};

declare module "claude-code" {
  interface PluginState {
    "specnaut-cockpit": {
      /** The last measurement the engine pushed. */
      reading: CockpitReading | null;
      /** Where the Specnaut chain stands. */
      chain: CockpitChain;
      /** The person hid the band for this session. */
      isHidden: boolean;
      /** Thresholds already announced, per window kind. */
      alerts: Record<string, { resetsAt?: string; announced: number }>;
      /** The windows of the last hold, until the person answers it. */
      held: CockpitWindow[];
      /** Windows the person chose to continue past: kind → the reset they saw. */
      lifted: Record<string, string | undefined>;
      /** The session's cost when it was last added to the history. */
      costSeen: number;
    };
  }
}
