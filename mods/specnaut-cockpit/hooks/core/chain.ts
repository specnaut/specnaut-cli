// Where the Specnaut chain stands, read from how its phases are invoked.
//
// The autopilot crosses each boundary by calling the Skill tool on the
// `specnaut` skill with the next phase as its argument; a person starts it by
// typing `/specnaut <phase>`. Both name the phase as the first argument that is
// not a flag. The Skill call returns as soon as the phase's instructions are
// loaded, so what can be known is the phase in progress, not its completion:
// a phase is done when the next one starts, and the chain is done when the turn
// that ran `merge` ends.

export const PHASES = ["plan", "tasks", "implement", "review", "merge"] as const;
export type Phase = typeof PHASES[number];

export type ChainState = {
  /** The phase in progress; null when no chain is running. */
  current: Phase | null;
  /** True once the turn that ran `merge` has ended. */
  finished: boolean;
};

export const IDLE: ChainState = { current: null, finished: false };

function isPhase(s: string): s is Phase {
  return (PHASES as readonly string[]).includes(s);
}

/**
 * True for Specnaut's router: `specnaut` as a project scaffolds it, and
 * `specnaut-plugin:specnaut` as the plugin serves it. Not any plugin's skill
 * that happens to be called `specnaut` — the hold refuses calls, so it names
 * exactly whose.
 */
export function isSpecnautSkill(skill: string): boolean {
  const name = skill.replace(/^\//, "");
  return name === "specnaut" || name === "specnaut-plugin:specnaut";
}

/** The chain phase a `specnaut` invocation starts, or null (audits, unknown, none). */
export function phaseOf(skill: string, args: string | undefined): Phase | null {
  if (!isSpecnautSkill(skill)) return null;
  const first = (args ?? "").trim().split(/\s+/).find((t) => t.length > 0 && !t.startsWith("--"));
  return first !== undefined && isPhase(first) ? first : null;
}

/** The phase a typed prompt starts: `/specnaut plan …`, `/specnaut-plugin:specnaut merge`. */
export function phaseOfPrompt(text: string): Phase | null {
  const m = text.trimStart().match(/^\/((?:specnaut-plugin:)?specnaut)(?:\s+([\s\S]*))?$/);
  return m ? phaseOf(m[1] ?? "", m[2]) : null;
}

export function advance(state: ChainState, phase: Phase): ChainState {
  // `plan` starts a new chain; any other phase resumes or continues one.
  void state;
  return { current: phase, finished: false };
}

/** The turn ended: a chain that reached `merge` is complete. */
export function turnEnded(state: ChainState): ChainState {
  return state.current === "merge" ? { current: "merge", finished: true } : state;
}

/** A prompt that is not a chain phase clears a finished chain from view. */
export function promptSubmitted(state: ChainState, phase: Phase | null): ChainState {
  if (phase) return advance(state, phase);
  return state.finished ? IDLE : state;
}

export type StepMark = "done" | "current" | "todo";

export function steps(state: ChainState): { phase: Phase; mark: StepMark }[] {
  if (!state.current) return [];
  const at = PHASES.indexOf(state.current);
  return PHASES.map((phase, i) => ({
    phase,
    mark: state.finished || i < at ? "done" : i === at ? "current" : "todo",
  }));
}

const GLYPH: Record<StepMark, string> = { done: "✓", current: "●", todo: "○" };

/** `plan ✓ tasks ✓ implement ● review ○ merge ○`, or `` when idle. */
export function chainLine(state: ChainState): string {
  return steps(state).map((s) => `${s.phase} ${GLYPH[s.mark]}`).join(" ");
}

/** `implement 3/5`, `merged ✓`, or `` when idle — for a narrow band. */
export function chainShort(state: ChainState): string {
  if (!state.current) return "";
  if (state.finished) return "merged ✓";
  return `${state.current} ${PHASES.indexOf(state.current) + 1}/${PHASES.length}`;
}
