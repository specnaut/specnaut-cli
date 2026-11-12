import { TASK_PHASES } from "./task_phases.ts";
/**
 * The Claude Code paths the plugin serves, one by one: what `isPluginCoveredPath` checks first and
 * `check --project` reads. Its own module so the list grows without growing the rules that use it.
 */
export const PLUGIN_COVERED_PATHS_CLAUDE: ReadonlyArray<string> = [
  // The agents' own index. `isPluginCoveredPath`'s agent regex has always
  // matched it (`README` !== `architect`), so `upgrade` would migrate it while
  // this list left `check --project` blind to it — the two consumers disagreeing
  // on a real file. Listing it makes them agree.
  ".claude/agents/README.md",
  ...[
    "code-reviewer",
    "developer",
    "product-owner",
    "security-expert",
    "specnaut-guide",
    "performance-expert",
    "accessibility-expert",
    "architect-expert",
    "dependency-expert",
  ].map((name) => `.claude/agents/${name}.md`),
  ".claude/skills/specnaut/SKILL.md",
  // The /ship skill (spec 033) — release concerns left /specnaut. Claiming a
  // skill means claiming all of its files: the parity test fails a skill that
  // is covered only in part.
  ".claude/skills/ship/SKILL.md",
  ".claude/skills/ship/phases/tag.md",
  ".claude/skills/ship/phases/release.md",
  ...["doc", "list", "upgrade", "issue"].map((name) => `.claude/skills/specnaut/phases/${name}.md`),

  // `task` (cli#683): the backlog verbs, the delivery pipeline and audits. Its
  // `scripts/` subtree is NOT here and must not be: those resolve paths
  // relative to their own location, so they fail criterion 3 — and they are
  // not emitted under `.claude/skills/` at all, they land in
  // `.specnaut/scripts/backlog/` and `.specnaut/scripts/audit/`. The documents
  // themselves name only project-root-relative paths and are plugin-servable
  // like any other.
  ".claude/skills/task/SKILL.md",
  ".claude/skills/task/backlog.md",
  ".claude/skills/task/groom.md",
  ".claude/skills/task/groom-report.md",
  ".claude/skills/task/resume.md",
  ".claude/skills/task/spec-autogen.md",
  ...TASK_PHASES.map((name) => `.claude/skills/task/phases/${name}.md`),

  // Every remaining core skill, each owning exactly one document. They were
  // uncovered not by decision but by omission: the list was written when
  // `specnaut` was the only skill, and each of these joined the plugin without
  // anyone revisiting it (specnaut-cli#605).
  ...[
    "backlog-frontmatter",
    "backlog-reference-contract",
    "design",
    "mobile-first-contract",
    "response-style-contract",
    "review-findings-contract",
    "specnaut-facts",
    "status-audit",
    "workflow-contract",
  ].map((name) => `.claude/skills/${name}/SKILL.md`),
  // The on-demand integrations reference `AGENTS.md` points at (cli#679).
  ".claude/skills/specnaut-facts/integrations.md",
];
