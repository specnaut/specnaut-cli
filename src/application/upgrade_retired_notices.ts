import type { FsReader } from "./ports.ts";

/**
 * Where the phase docs used to look for extension hooks (`hooks.before_plan`
 * and the like). No release read it in code: the phases did, in prose, and
 * spec 041 removed those blocks. A project that wrote one would otherwise lose
 * its hook with nothing said.
 */
export const RETIRED_EXTENSIONS_PATH = ".specnaut/extensions.yml";

/**
 * Each agent spec 043 retired, and what does its work now. The one table of
 * it: the files themselves leave through the lock-driven orphan path like any
 * file the bundle stopped shipping, so nothing deletes by these names — they
 * only let upgrade say what a project's own dispatch should name instead.
 */
export const RETIRED_AGENTS: Readonly<Record<string, string>> = {
  "review-coordinator": "the main session runs phases/review.md",
  "test-reviewer": "code-reviewer",
  "ui-ux-designer": "/design",
  "workflow-manager": "the main session / /task",
  "qa-tester": "the main session / /task",
  "devops-sre": "the main session / /task",
};

/** The folder of each harness's agents that a project may add its own to. */
const AGENT_DIRS: ReadonlyArray<{ dir: string; ext: string }> = [
  { dir: ".claude/agents", ext: ".md" },
  { dir: ".codex/agents", ext: ".toml" },
];

/** A name as a whole word: `qa-tester` in `my-qa-tester-notes` is not a dispatch. */
const names = (text: string, name: string) =>
  new RegExp(`(?<![\\w-])${name.replace(/-/g, "\\-")}(?![\\w-])`).test(text);

/**
 * The files the user owns that could dispatch an agent: every phase addendum,
 * and each agent file directly in a harness's agent folder that the lock does
 * not record. A tracked agent is Specnaut's — a kept customised retired one is
 * already reported as an orphan — and an agent's memory folder holds seeds and
 * their backups, not dispatches.
 */
async function userDispatchFiles(
  reader: FsReader,
  projectDir: string,
  tracked: ReadonlySet<string>,
): Promise<string[]> {
  const agents = await Promise.all(
    AGENT_DIRS.map(async ({ dir, ext }) =>
      (await reader.listFiles(projectDir, dir)).filter((p) =>
        p.endsWith(ext) && !p.slice(dir.length + 1).includes("/") && !tracked.has(p)
      )
    ),
  );
  return [...await reader.listFiles(projectDir, ".specnaut/addenda"), ...agents.flat()];
}

/**
 * One line per user-owned file that names a retired agent, then the rule for
 * the seeds those agents leave. Read-only: nothing here writes or deletes, and
 * a dispatch that names a missing agent fails silently in the harness, which
 * is why it is said rather than left to be found.
 */
async function retiredAgentNotices(
  reader: FsReader,
  projectDir: string,
  tracked: ReadonlySet<string>,
): Promise<string[]> {
  const lines: string[] = [];
  for (const path of await userDispatchFiles(reader, projectDir, tracked)) {
    const text = await reader.readText(projectDir, path);
    if (text === null) continue;
    const hits = Object.entries(RETIRED_AGENTS).filter(([name]) => names(text, name));
    if (hits.length === 0) continue;
    const moves = hits.map(([name, successor]) => `${name} → ${successor}`).join("; ");
    lines.push(`${path} names a retired agent — ${moves}`);
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    "A retired agent's customised memory seeds are kept until `specnaut upgrade --force`, " +
    "which backs them up",
  ];
}

/**
 * What upgrade says about project files a retired mechanism used to read.
 * `tracked` is every path the lock records — the files that are Specnaut's.
 */
export async function retiredConfigNotices(
  reader: FsReader,
  projectDir: string,
  tracked: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];
  if ((await reader.readEntry(projectDir, RETIRED_EXTENSIONS_PATH)) !== null) {
    out.push(
      `${RETIRED_EXTENSIONS_PATH} is no longer read — the /task phases dropped their extension ` +
        `hooks. Move each hook into the phase's addendum, .specnaut/addenda/task/<phase>.md`,
    );
  }
  return [...out, ...await retiredAgentNotices(reader, projectDir, tracked)];
}
