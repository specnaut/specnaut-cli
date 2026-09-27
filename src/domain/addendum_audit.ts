import { SKILL_DOC_RENAMES } from "./skill_doc_renames.ts";

/**
 * Where a project's phase addenda live (#611). Under `.specnaut/`, the one root
 * no harness relocates, so the path is the same whatever harness is installed.
 */
export const ADDENDA_ROOT = ".specnaut/addenda";

/** The skills whose routers read an addendum. No other skill reads one. */
export const ADDENDUM_SKILLS = ["specnaut", "ship"] as const;
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
  specnaut: [
    "plan",
    "tasks",
    "implement",
    "review",
    "merge",
    "constitution",
    "audit-security",
    "audit-performance",
    "audit-accessibility",
    "audit-architecture",
    "audit-dependencies",
  ],
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

const sp = (phase: string): PhaseAddress => ({ skill: "specnaut", phase });

/**
 * Parents follow the `/specnaut` router's own account of who loads what.
 * `auto-chain` is loaded by the router when a chainable phase completes, so its
 * step belongs in the addendum of the phase it follows.
 */
export const CONTRACT_DOCS: ReadonlyArray<ContractDoc> = [
  { skill: "specnaut", doc: "plan-audits", parents: [sp("plan")] },
  { skill: "specnaut", doc: "merge-squash", parents: [sp("merge")] },
  { skill: "specnaut", doc: "epic-commits", parents: [sp("implement")] },
  { skill: "specnaut", doc: "quality-gates", parents: [sp("implement"), sp("merge")] },
  { skill: "specnaut", doc: "epic-fixups", parents: [sp("merge")] },
  { skill: "specnaut", doc: "merge-close", parents: [sp("merge")] },
  { skill: "specnaut", doc: "epic-loop", parents: [sp("implement")] },
  {
    skill: "specnaut",
    doc: "auto-chain",
    parents: [sp("plan"), sp("tasks"), sp("implement"), sp("review")],
  },
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
    if (rename) return finding({ kind: "renamed", reason: rename.reason }, rename.to);
    const contract = CONTRACT_DOCS.find((c) => c.skill === skillDir && c.doc === stem);
    if (contract) return finding({ kind: "contract-doc", parents: contract.parents }, null);
    return finding({ kind: "unknown-phase", skill: skillDir }, suggestFor(skillDir, stem));
  }

  const suggestion = renameOf(skillDir, stem)?.to ?? suggestFor(skillDir, stem);
  if (segments.length !== 2) return finding({ kind: "wrong-depth" }, suggestion);
  if (!isAddendumSkill(skillDir)) {
    return finding({ kind: "unknown-skill", skill: skillDir ?? "" }, suggestion);
  }
  return finding({ kind: "not-markdown" }, suggestion);
}

/** The rename whose old address is `<skill>/<stem>`, as an addressed pair. */
function renameOf(
  skill: string | null,
  stem: string,
): { to: PhaseAddress; reason: string } | null {
  const r = SKILL_DOC_RENAMES.find((x) =>
    x.from.owner === skill && x.from.doc.replace(/\.md$/, "") === stem
  );
  if (!r || !isAddendumSkill(r.to.owner)) return null;
  return { to: { skill: r.to.owner, phase: r.to.doc.replace(/\.md$/, "") }, reason: r.reason };
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
