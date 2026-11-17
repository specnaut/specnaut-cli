// Which chain phase a router invocation starts — the quota hold's one input.
//
// The autopilot crosses each boundary by calling the Skill tool on the
// `task` skill with the next phase as its argument. That call names the phase
// as the first argument that is not a flag, and the hold refuses it when a
// usage window is past its threshold (hold.ts). The cockpit no longer draws the
// chain's progress: a Skill call says a phase starts, never that one finished,
// so a drawn chain stayed "in progress" long after it had stopped (cli#797).

export const PHASES = ["plan", "implement", "review", "merge"] as const;
export type Phase = typeof PHASES[number];

function isPhase(s: string): s is Phase {
  return (PHASES as readonly string[]).includes(s);
}

/**
 * The routers that run the chain: `task` as a project scaffolds it and
 * `specnaut-plugin:task` as the plugin serves it — and `specnaut` /
 * `specnaut-plugin:specnaut`, which ran it before 7.2 (cli#683) and still do
 * under an older plugin. Dropping those would switch the hold off silently for
 * anyone whose plugin lags the binary. Not any plugin's skill that happens to
 * carry one of these names — the hold refuses calls, so it names exactly whose.
 */
const CHAIN_ROUTERS: readonly string[] = [
  "task",
  "specnaut-plugin:task",
  "specnaut",
  "specnaut-plugin:specnaut",
];

function isSpecnautSkill(skill: string): boolean {
  return CHAIN_ROUTERS.includes(skill.replace(/^\//, ""));
}

/** The chain phase a router invocation starts, or null (audits, unknown, none). */
export function phaseOf(skill: string, args: string | undefined): Phase | null {
  if (!isSpecnautSkill(skill)) return null;
  const first = (args ?? "").trim().split(/\s+/).find((t) => t.length > 0 && !t.startsWith("--"));
  return first !== undefined && isPhase(first) ? first : null;
}
