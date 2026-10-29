import type { CoreCategory, CoreEntry } from "./core_bundle.ts";
import { SemVer } from "./release.ts";

/**
 * The two sub-document categories a rename can move. Both ends of a row are the
 * same kind: the kind decides the subdirectory (`phases/` or none), so a
 * backlog doc resolved as a phase would land under `phases/`, the rename would
 * find nothing there, and the file would orphan (plan 037 § 9).
 */
export type SkillDocKind = Extract<CoreCategory, "phase" | "backlog-doc">;

/**
 * A skill sub-document that changed address between template versions.
 *
 * Declared as **(owner, document)** rather than as a path, deliberately. A path
 * is harness-specific — the same document is
 * `.claude/skills/ship/phases/tag.md` on Claude and
 * `.github/instructions/specnaut-ship-tag.instructions.md` on Copilot — and spelling either
 * here would be a second statement of the adapter's rule, which spec 033 §5
 * forbids. The harness resolves both ends itself.
 */
export interface SkillDocRename {
  readonly from: { readonly owner: string; readonly doc: string };
  readonly to: { readonly owner: string; readonly doc: string };
  /** Why it moved — surfaced to the user when a customised file travels. */
  readonly reason: string;
  /** Which sub-document both ends are; `phase` when absent. */
  readonly kind?: SkillDocKind;
}

const TO_TASK = "one unit of work moved from /specnaut to /task";

/** A phase or contract doc that moved from `/specnaut` to `/task` unchanged in name. */
function phaseMove(doc: string): SkillDocRename {
  return { from: { owner: "specnaut", doc }, to: { owner: "task", doc }, reason: TO_TASK };
}

/** A backlog doc that moved from beside `/board`'s router to beside `/task`'s. */
function backlogDocMove(doc: string): SkillDocRename {
  return {
    from: { owner: "board", doc },
    to: { owner: "task", doc },
    reason: "the backlog moved from /board to /task",
    kind: "backlog-doc",
  };
}

/**
 * **Why this exists at all.**
 *
 * Without it, a document that changes address is two unrelated events to
 * `upgrade`: an orphan at the old path and a new file at the new one. The
 * user's bytes are not lost — a customised orphan is deleted only under
 * `--force`, and then with a backup — but they stop being *read*. The agent
 * loads the vanilla document at the new address while the edit sits at the old
 * one, and the upgrade reports success.
 *
 * That is worse than losing them. If the edit was a guardrail — "never publish
 * without a signed tag" — the guardrail is now inert and nothing said so.
 *
 * Carrying the lock identity across the move makes the rename ONE event: the
 * bytes arrive at the new address and land in the ordinary `customized` bucket,
 * where the upgrade summary names them like any other divergence.
 */
export const SKILL_DOC_RENAMES: ReadonlyArray<SkillDocRename> = [
  {
    from: { owner: "specnaut", doc: "tag-version.md" },
    to: { owner: "ship", doc: "tag.md" },
    reason: "release concerns moved from /specnaut to /ship",
  },
  {
    from: { owner: "specnaut", doc: "release-version.md" },
    to: { owner: "ship", doc: "release.md" },
    reason: "release concerns moved from /specnaut to /ship",
  },
  ...[
    // `plan-audits.md` and `tasks.md` moved here too, then retired (spec 041): their vanilla
    // copies prune as orphans, and a `tasks` addendum is carried by `PHASE_FOLDS`.
    "plan.md",
    "implement.md",
    "epic-commits.md",
    "epic-fixups.md",
    "epic-loop.md",
    "quality-gates.md",
    "review.md",
    "merge.md",
    "merge-squash.md",
    "merge-close.md",
    "auto-chain.md",
    "constitution.md",
  ].map(phaseMove),
  ...["groom.md", "groom-report.md", "spec-autogen.md"].map(backlogDocMove),
];

/**
 * The router whose phase table pointed at the docs moved to `/task`, and the
 * templates release that moved them (spec 037).
 *
 * A customised copy of that router is kept by `upgrade` like any other
 * customisation — and it still routes `plan` to a `phases/plan.md` that is no
 * longer beside it. Nothing fails: the agent improvises, and a guardrail
 * written into the router stops applying. So it is named, by `upgrade` and
 * durably by `check --project`, until its baseline is re-taken at or after the
 * move (`reconcile`, or `--force`).
 */
export const PHASES_LEFT_ROUTER = { owner: "specnaut", movedIn: "7.2.0" } as const;

/**
 * What to say about such a router, after its path — one text for `upgrade` and
 * `check --project`, so the two never give different advice.
 */
export function staleRouterAdvice(dest: string): string {
  return `is customised from before the phases moved to /task ` +
    `(templates ${PHASES_LEFT_ROUTER.movedIn}), so it still routes them to addresses that are ` +
    `gone — re-apply your edit to the new router (\`specnaut diff ${dest}\`), then ` +
    `\`specnaut reconcile ${dest} --accept-upstream\``;
}

/**
 * Whether a router file recorded at `baselineVersion` predates the move. A
 * version this binary cannot read counts as predating it: the cost of a wrong
 * `true` is one warning, of a wrong `false` an inert guardrail nobody hears of.
 */
export function predatesPhaseMove(baselineVersion: string): boolean {
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baselineVersion.trim())) return true;
  return SemVer.parse(baselineVersion).compare(SemVer.parse(PHASES_LEFT_ROUTER.movedIn)) < 0;
}

/**
 * A synthetic bundle entry standing for one end of a rename, so a harness can
 * be asked where it *would* have put it. The content is irrelevant — only the
 * destination is read — but it must be a well-formed entry or `mapBundle`
 * refuses it.
 */
export function renameEndpointEntry(
  owner: string,
  doc: string,
  kind: SkillDocKind = "phase",
): CoreEntry {
  return { category: kind, name: owner, suffix: doc, content: "", executable: false };
}

/** The same stand-in for a skill's router itself, e.g. `specnaut/SKILL.md`. */
export function routerEndpointEntry(owner: string): CoreEntry {
  return { category: "skill", name: owner, suffix: null, content: "", executable: false };
}
