import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import {
  gitIn,
  installScripts,
  type Result,
  runGate,
  tempDir,
  type Twin,
  writeFiles,
} from "./run_gate_fixture.ts";
import { reportOf } from "./gate_impact_report.ts";

export { labelled, reportOf } from "./gate_impact_report.ts";

/**
 * A synthetic repository holding invented workspaces, with an invented adapter
 * that reads the graph from the tree it is told to describe. Scoped commands
 * write markers outside the repository, so a run leaves the tree clean and a test
 * reads what really ran. The graph lives under `.graph/`, which the declaration
 * calls inert, so a test can change an edge without touching a workspace.
 */

export type Owner = { id: string; roots: string[]; depends_on: string[] };

export const OWNERS: Owner[] = [
  { id: "core", roots: ["libs/core/"], depends_on: [] },
  { id: "api", roots: ["apps/api/"], depends_on: ["core"] },
  { id: "web", roots: ["apps/web/"], depends_on: ["api"] },
  { id: "guide", roots: ["docs/guide.md"], depends_on: [] },
];

export const ADAPTER = "tools/impact-adapter.sh";
export const SUITE = "bash tools/mark.sh suite";
export const WEB_ONLY = "bash tools/mark.sh web-only";
export const ALWAYS = "bash tools/mark.sh always";

export const declaration = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  adapter: { command: `bash ${ADAPTER}`, files: [ADAPTER] },
  scoped_tiers: ["fast"],
  full_on: ["locks/app.lock", "tools/build/"],
  inert: [".graph/", ".specnaut/specs/", ".specnaut/feature.json"],
  checks: [
    { gate: SUITE, scoped: "bash tools/mark.sh suite-scoped" },
    { gate: WEB_ONLY, scoped: "bash tools/mark.sh web-scoped", owners: ["web"] },
  ],
  ...over,
});

export const GATES = `fast_gate:
  - ${SUITE}
  - ${WEB_ONLY}
  - ${ALWAYS}
full_gate:
  - ${SUITE}
`;

const ADAPTER_SH = `#!/usr/bin/env bash
# An invented adapter: the graph is a file in the tree it describes.
printf '%s|%s|%s\\n' "$(pwd)" "$SPECNAUT_IMPACT_TREE" "$SPECNAUT_IMPACT_COMMIT" >>"$ADAPTER_LOG"
{
  printf '{"schema":%s,"commit":"%s","complete":true,"owners":' "$SPECNAUT_IMPACT_SCHEMA" "$SPECNAUT_IMPACT_COMMIT"
  cat "$SPECNAUT_IMPACT_TREE/.graph/owners.json"
  printf '}\\n'
} >"$SPECNAUT_IMPACT_OUT"
`;

const MARK_SH = `#!/usr/bin/env bash
printf '%s %s\\n' "$1" "\${SPECNAUT_AFFECTED_OWNERS-unset}" >>"$MARK_FILE"
`;

export type RepoOptions = {
  owners?: Owner[];
  gates?: string;
  /** The declaration's text, or null for none. */
  declaration?: string | null;
  files?: Record<string, string>;
};

export type Report = Result & {
  marks: string[];
  /** The label lines of the report, in order, with the evidence path reduced to a fact. */
  report: string[];
};

/** A catch that accepts a file not being there, and nothing else. */
export const ifAbsent = <T>(fallback: T) => (e: unknown): T => {
  if (e instanceof Deno.errors.NotFound) return fallback;
  throw e;
};

const linesOf = async (path: string): Promise<string[]> =>
  (await Deno.readTextFile(path).catch(ifAbsent(""))).replaceAll("\r", "").split("\n").filter(
    Boolean,
  );

export class Repo {
  /** The commit a feature branch starts from. */
  main = "";
  private marks: string;
  adapterLog: string;

  constructor(readonly root: string, readonly outside: string) {
    this.marks = join(outside, "marks");
    this.adapterLog = join(outside, "adapter.log");
  }

  /** The scripts drop every GIT_* variable, so global git config is kept out by home folder. */
  env() {
    const home = join(this.outside, "home"), xdg = join(home, ".config");
    const logs = { MARK_FILE: bashPath(this.marks), ADAPTER_LOG: bashPath(this.adapterLog) };
    return { ...logs, HOME: home, XDG_CONFIG_HOME: xdg };
  }

  git(...args: string[]): Promise<string> {
    return gitIn(this.root, ...args);
  }

  /** Writes the files and commits every change in the tree; returns the commit. */
  async commit(files: Record<string, string> = {}, remove: string[] = []): Promise<string> {
    await writeFiles(this.root, files);
    for (const path of remove) await Deno.remove(join(this.root, path), { recursive: true });
    await this.git("add", "-A");
    await this.git("commit", "-q", "--allow-empty", "-m", "change");
    return this.git("rev-parse", "HEAD");
  }

  /** A bare `origin` holding main, whose HEAD is main: what a real clone has. */
  async withOrigin(): Promise<void> {
    const bare = join(this.outside, "origin.git");
    await gitIn(this.outside, "init", "-q", "--bare", "-b", "main", "origin.git");
    await this.git("remote", "add", "origin", bare);
    await this.git("push", "-q", "origin", "main");
    await this.git("remote", "set-head", "origin", "main");
  }

  graph(owners: Owner[]) {
    return { ".graph/owners.json": JSON.stringify(owners) };
  }

  /** `run-gate` with `args`; what it ran and what it reported. */
  async gate(
    twin: Twin,
    args: string[],
    opts: { stdin?: string; env?: Record<string, string> } = {},
  ): Promise<Report> {
    await Deno.remove(this.marks).catch(ifAbsent(undefined));
    const r = await runGate(twin, this.root, args, {
      stdin: opts.stdin,
      env: { ...this.env(), ...opts.env },
    });
    return { ...r, marks: await linesOf(this.marks), report: reportOf(r.stdout) };
  }

  adapterRuns(): Promise<string[]> {
    return linesOf(this.adapterLog);
  }

  async worktrees(): Promise<number> {
    return (await this.git("worktree", "list", "--porcelain")).split("\n")
      .filter((l) => l.startsWith("worktree ")).length;
  }
}

/** A repository on `feature`, branched from a `main` that holds the whole fixture. */
export async function impactRepo(opts: RepoOptions = {}): Promise<Repo> {
  const root = await tempDir("gate-impact-");
  const outside = await tempDir("gate-impact-out-");
  const repo = new Repo(root, outside);
  await Deno.mkdir(join(outside, "home"));
  await repo.git("init", "-q", "-b", "main");
  await repo.git("config", "init.defaultBranch", "main");
  await repo.git("config", "core.autocrlf", "false");
  await repo.git("config", "user.name", "t");
  await repo.git("config", "user.email", "t@example.invalid");
  await repo.git("config", "commit.gpgsign", "false");
  await installScripts(root);
  await writeFiles(root, {
    ".specnaut/gates.yml": opts.gates ?? GATES,
    [ADAPTER]: ADAPTER_SH,
    "tools/mark.sh": MARK_SH,
    "libs/core/a.ts": "core\n",
    "apps/api/a.ts": "api\n",
    "apps/web/a.ts": "web\n",
    "docs/guide.md": "guide\n",
    "locks/app.lock": "v1\n",
    "README.md": "an invented project\n",
    ...repo.graph(opts.owners ?? OWNERS),
    ...opts.files,
  });
  const decl = opts.declaration === undefined ? JSON.stringify(declaration()) : opts.declaration;
  if (decl !== null) await writeFiles(root, { ".specnaut/impact.json": decl });
  repo.main = await repo.commit();
  await repo.git("switch", "-q", "-c", "feature");
  return repo;
}
