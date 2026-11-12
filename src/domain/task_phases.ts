/**
 * The phase and contract documents of the `/task` skill, by name: `phases/<name>.md`. The one
 * list, read by the plugin coverage rule and by the plugin's mirror test, so a document added to
 * the skill is added once.
 */
export const TASK_PHASES: readonly string[] = [
  "plan",
  "plan-reentry",
  "implement",
  "review",
  "review-seats",
  "review-gates",
  "review-untrusted",
  "merge",
  "audit",
  "constitution",
  "auto-chain",
  "remote-gates",
  "script-gate",
  "orphan-specs",
  "epic-commits",
  "epic-fixups",
  "epic-loop",
  "merge-close",
  "merge-squash",
  "quality-gates",
];
