import { SKILL_DOC_RENAMES } from "./skill_doc_renames.ts";

/**
 * Where a project's phase addenda live (#611). Under `.specnaut/`, the one root
 * no harness relocates, so the path is the same whatever harness is installed.
 */
export const ADDENDA_ROOT = ".specnaut/addenda";

/** The skills whose routers read an addendum. No other skill reads one. */
export const ADDENDUM_SKILLS = ["specnaut", "task", "ship"] as const;
export type AddendumSkill = typeof ADDENDUM_SKILLS[number];

/** One `<skill>/<phase>` an addendum can be written for. */
export interface PhaseAddress {
  readonly skill: AddendumSkill;
  readonly phase: string;
}

/**
 * The routable phases of each router, **in the order of its phase table**.
 *
 * Declared here rather than read from the project's installed `phases/`
 * directory, deliberately (#622): a listing would also hold the contract docs,
 * which the router never reads an addendum for, and harnesses lay phases out
 * differently on disk. The set is the running binary's bundle — what `upgrade`
 * installs. A project whose templates lag it is already reported by the
 * templates-version check.
 *
 * The order is load-bearing: suggestion ties go to the earliest row.
 * `tests/templates/routable_phases_test.ts` pins both the set and the order
 * against the bundled routers, so a phase added or renamed there fails a test
 * instead of turning this check stale.
 */
export const ROUTABLE_PHASES: Readonly<Record<AddendumSkill, ReadonlyArray<string>>> = {
  specnaut: ["doc", "list", "upgrade"],
  // `groom` is the one backlog verb that reads an addendum: it is a full pass,
  // where the others are single reads or writes (plan 037 § 10).
  task: ["groom", "plan", "implement", "review", "merge", "audit", "constitution"],
  ship: ["tag", "release"],
};

/**
 * A document that sits beside the phases but is loaded BY a phase (or by the
 * router itself), never routed to. The router reads no addendum for it — its
 * step is named in the addendum of the phase that loads it, which is what
 * `parents` points at.
 */
export interface ContractDoc {
  readonly skill: AddendumSkill;
  readonly doc: string;
  readonly parents: ReadonlyArray<PhaseAddress>;
}

const tk = (phase: string): PhaseAddress => ({ skill: "task", phase });

/**
 * Parents follow the `/task` router's own account of who loads what.
 * `auto-chain` is loaded by the router when a chainable phase completes, so its
 * step belongs in the addendum of the phase it follows.
 */
export const CONTRACT_DOCS: ReadonlyArray<ContractDoc> = [
  { skill: "task", doc: "merge-squash", parents: [tk("merge")] },
  { skill: "task", doc: "epic-commits", parents: [tk("implement")] },
  { skill: "task", doc: "quality-gates", parents: [tk("implement"), tk("merge")] },
  { skill: "task", doc: "epic-fixups", parents: [tk("merge")] },
  { skill: "task", doc: "merge-close", parents: [tk("merge")] },
  { skill: "task", doc: "epic-loop", parents: [tk("implement")] },
  { skill: "task", doc: "auto-chain", parents: [tk("plan"), tk("implement"), tk("review")] },
  // Loaded by auto-chain in remote mode, at the plan stop and at the review verdict.
  { skill: "task", doc: "remote-gates", parents: [tk("plan"), tk("review")] },
  // Loaded by groom's orphan-spec step (spec 041).
  { skill: "task", doc: "orphan-specs", parents: [tk("groom")] },
];

/**
 * A phase that stopped being a verb and whose work moved into another one
 * (spec 041). Unlike a `SKILL_DOC_RENAMES` row, nothing moves but the
 * ADDENDUM's address: the retired doc's bytes are not the successor's, so they
 * are pruned as an orphan rather than carried. Each row is resolved to its end
 * — never a step through another retired address.
 */
export interface PhaseFold {
  readonly from: { readonly skill: string; readonly phase: string };
  readonly into: PhaseAddress;
  readonly reason: string;
}

const TASKS_FOLDED =
  "the tasks breakdown is now done inside implement — re-anchor the steps this addendum names";

export const PHASE_FOLDS: ReadonlyArray<PhaseFold> = [
  { from: { skill: "task", phase: "tasks" }, into: tk("implement"), reason: TASKS_FOLDED },
  { from: { skill: "specnaut", phase: "tasks" }, into: tk("implement"), reason: TASKS_FOLDED },
];

/** Why an addendum file is never read. */
export type AddendumProblem =
  | { readonly kind: "wrong-depth" }
  | { readonly kind: "unknown-skill"; readonly skill: string }
  | { readonly kind: "not-markdown" }
  | { readonly kind: "unknown-phase"; readonly skill: AddendumSkill }
  | { readonly kind: "renamed"; readonly reason: string }
  | { readonly kind: "contract-doc"; readonly parents: ReadonlyArray<PhaseAddress> };

export interface AddendumFinding {
  /** Relative to {@link ADDENDA_ROOT}, `/`-separated. */
  readonly path: string;
  readonly problem: AddendumProblem;
  /** The nearest valid address, or `null` when nothing is reasonably close. */
  readonly suggestion: PhaseAddress | null;
}

/** `.specnaut/addenda/<skill>/<phase>.md` — the path a router reads. */
export function addendumPath(address: PhaseAddress): string {
  return `${ADDENDA_ROOT}/${address.skill}/${address.phase}.md`;
}

function isAddendumSkill(name: string | null): name is AddendumSkill {
  return (ADDENDUM_SKILLS as ReadonlyArray<string>).includes(name ?? "");
}

/**
 * Judges one file found under the addenda root (#622).
 *
 * Returns `null` when the file is read by a router, or is ignored. Dotfiles are
 * ignored at any depth: editor and OS artefacts (`.DS_Store`, swap files) would
 * otherwise make `check` warn permanently on some machines and teach its
 * readers to skip warnings.
 *
 * Anything else that is not exactly `<skill>/<phase>.md` for a routable phase
 * is a finding, carrying the nearest valid address when one is reasonably
 * close — see {@link suggestFor}.
 */
export function auditAddendum(relPath: string): AddendumFinding | null {
  const segments = relPath.split("/");
  if (segments.some((s) => s.startsWith("."))) return null;

  const file = segments[segments.length - 1];
  const isMarkdown = file.endsWith(".md");
  const stem = isMarkdown ? file.slice(0, -".md".length) : file.replace(/\.[^.]*$/, "");
  const skillDir = segments.length >= 2 ? segments[0] : null;
  const finding = (problem: AddendumProblem, suggestion: PhaseAddress | null) => ({
    path: relPath,
    problem,
    suggestion,
  });

  if (segments.length === 2 && isAddendumSkill(skillDir) && isMarkdown) {
    if (ROUTABLE_PHASES[skillDir].includes(stem)) return null;
    const rename = renameOf(skillDir, stem);
    // A contract doc that moved is still a contract doc: pointing at its new
    // address would send the user from one unread path to another.
    const contract = contractDocAt(rename?.to ?? { skill: skillDir, phase: stem });
    if (contract) return finding({ kind: "contract-doc", parents: contract.parents }, null);
    if (rename) return finding({ kind: "renamed", reason: rename.reason }, rename.to);
    return finding({ kind: "unknown-phase", skill: skillDir }, suggestFor(skillDir, stem));
  }

  const moved = renameOf(skillDir, stem)?.to;
  // A moved doc that is not itself routable (`groom-report`, loaded by groom)
  // is pointed at the nearest phase of its new skill, never at another unread path.
  const suggestion = moved
    ? (ROUTABLE_PHASES[moved.skill].includes(moved.phase)
      ? moved
      : suggestFor(moved.skill, moved.phase))
    : suggestFor(skillDir, stem);
  if (segments.length !== 2) return finding({ kind: "wrong-depth" }, suggestion);
  if (!isAddendumSkill(skillDir)) {
    return finding({ kind: "unknown-skill", skill: skillDir ?? "" }, suggestion);
  }
  return finding({ kind: "not-markdown" }, suggestion);
}

function contractDocAt(address: PhaseAddress): ContractDoc | undefined {
  return CONTRACT_DOCS.find((c) => c.skill === address.skill && c.doc === address.phase);
}

const stemOf = (doc: string) => doc.replace(/\.md$/, "");

/** One addendum the upgrade carries to its phase's new address (FR-005). */
export interface AddendumRename {
  readonly from: PhaseAddress;
  readonly to: PhaseAddress;
  readonly reason: string;
}

/**
 * The addendum moves, **derived from `SKILL_DOC_RENAMES`** rather than listed
 * (plan 037 § 5): a phase that moves without its addendum leaves a guardrail
 * at an address no router reads, which is how the spec 033 `/ship` rename
 * stranded `specnaut/tag-version.md`.
 *
 * Rows whose both ends sit under a skill that reads addenda. The backlog docs
 * leaving `/board` carry none: `/board` read no addendum, so a file under
 * `addenda/board/` was never in force, and moving it would switch it on with
 * nobody having asked. The {@link PHASE_FOLDS} follow, with their own reason.
 */
export function addendumRenames(): ReadonlyArray<AddendumRename> {
  const folds = PHASE_FOLDS.flatMap((f) =>
    isAddendumSkill(f.from.skill)
      ? [{ from: { skill: f.from.skill, phase: f.from.phase }, to: f.into, reason: f.reason }]
      : []
  );
  return [
    ...SKILL_DOC_RENAMES.flatMap((r) => {
      const { from, to } = r;
      if (!isAddendumSkill(from.owner) || !isAddendumSkill(to.owner)) return [];
      return [{
        from: { skill: from.owner, phase: stemOf(from.doc) },
        to: { skill: to.owner, phase: stemOf(to.doc) },
        reason: r.reason,
      }];
    }),
    ...folds,
  ];
}

/** The rename whose old address is `<skill>/<stem>`, as an addressed pair. */
function renameOf(
  skill: string | null,
  stem: string,
): { to: PhaseAddress; reason: string } | null {
  const fold = PHASE_FOLDS.find((f) => f.from.skill === skill && f.from.phase === stem);
  if (fold) return { to: fold.into, reason: fold.reason };
  const r = SKILL_DOC_RENAMES.find((x) => x.from.owner === skill && stemOf(x.from.doc) === stem);
  if (!r || !isAddendumSkill(r.to.owner)) return null;
  return { to: { skill: r.to.owner, phase: stemOf(r.to.doc) }, reason: r.reason };
}

/**
 * The nearest routable phase to `stem`: one of the same skill when the file
 * sits under a known skill, else one of any skill.
 *
 * **Why prefix-or-two-edits and not a bare distance threshold** (settled on
 * #622): `planning` → `plan` is four edits, and any threshold wide enough to
 * admit it would propose unrelated short phases for every short typo. A prefix
 * either way catches the too-long and too-short names; two edits catch
 * transpositions and slips (`reveiw` → `review`). Ties go to the earliest row
 * of the router's phase table.
 */
function suggestFor(skill: string | null, stem: string): PhaseAddress | null {
  const skills = isAddendumSkill(skill) ? [skill] : ADDENDUM_SKILLS;
  const candidates = skills.flatMap((s) =>
    ROUTABLE_PHASES[s].map((phase) => ({ skill: s, phase }))
  );
  const name = stem.toLowerCase();
  if (name === "") return null;

  const prefix = candidates.find((c) => name.startsWith(c.phase) || c.phase.startsWith(name));
  if (prefix) return prefix;

  let best: PhaseAddress | null = null;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = levenshtein(name, c.phase);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}
