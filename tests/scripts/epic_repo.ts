import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * The real-git fixture both epic branch lookup test files share (cli#731,
 * cli#733): the two twins as runners, an isolated repo whose backlog stub makes
 * 42 a child of epic 7, and the branch-shaping helpers.
 */

const CORE = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
export const EPIC = 7;
export const CHILD = 42;

async function hasPwsh(): Promise<boolean> {
  try {
    const { code } = await new Deno.Command("pwsh", {
      args: ["-NoProfile", "-Command", "exit 0"],
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
export const PWSH_AVAILABLE = await hasPwsh();

/** A twin to run; `env` is laid over the isolated environment, `text` drops its JSON flag. */
export type Runner = {
  name: string;
  argv: string[];
  dryRun: string;
  json: string;
  env?: Record<string, string>;
};
export const RUNNERS: Runner[] = [{
  name: "bash",
  argv: ["bash", join(CORE, "bash", "create-new-feature.sh"), "--json", "--issue", `${CHILD}`],
  dryRun: "--dry-run",
  json: "--json",
}];
if (PWSH_AVAILABLE) {
  RUNNERS.push({
    name: "pwsh",
    argv: [
      "pwsh",
      "-NoProfile",
      "-File",
      join(CORE, "powershell", "create-new-feature.ps1"),
      "-Json",
      "-Issue",
      `${CHILD}`,
    ],
    dryRun: "-DryRun",
    json: "-Json",
  });
}

/** The CI guard each file carries: off CI there is nothing to assert. */
export function pwshRunsOnCi(file: string) {
  Deno.test({
    name: `${file}: the PowerShell arm actually runs on CI`,
    ignore: Deno.env.get("CI") !== "true",
    fn: () => assert(PWSH_AVAILABLE, "pwsh is absent on CI — the PowerShell scenarios did not run"),
  });
}

/** The same twin, printing text rather than JSON. */
export const text = (r: Runner): Runner => ({ ...r, argv: r.argv.filter((a) => a !== r.json) });

export type Repo = {
  dir: string;
  git: (...args: string[]) => Promise<string>;
  run: (runner: Runner, ...extra: string[]) => Promise<{ code: number; out: string }>;
  /** Any command in the repo, isolated like the twins; `env` laid over it. */
  exec: (argv: string[], env?: Record<string, string>) => Promise<{ code: number; out: string }>;
  head: () => Promise<string>;
};

export const EPIC_BRANCH_SH = join(CORE, "bash", "epic-branch.sh");

/**
 * Children see no global or system git config and inherit no `GIT_*` variable
 * (`GIT_DIR`, `GIT_INDEX_FILE`… from a hook): the fixture is all they read.
 */
const ISOLATED = {
  ...Object.fromEntries(Object.entries(Deno.env.toObject()).filter(([k]) => !/^GIT_/.test(k))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function makeGit(dir: string) {
  return async (...args: string[]) => {
    const { code, stdout, stderr } = await new Deno.Command("git", {
      args,
      cwd: dir,
      env: ISOLATED,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (code !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`);
    return new TextDecoder().decode(stdout).trim();
  };
}

/** `main` (pinned by `init.defaultBranch`, no origin), and a backlog stub: issue 42 is a child of epic 7. */
async function seedRepo(dir: string, git: Repo["git"]) {
  await git("init", "-q", "-b", "main");
  await git("config", "init.defaultBranch", "main");
  await git("config", "user.email", "t@example.invalid");
  await git("config", "user.name", "t");
  await git("config", "commit.gpgsign", "false");
  const backlog = join(dir, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(backlog, { recursive: true });
  await Deno.mkdir(join(dir, ".specnaut", "templates"), { recursive: true });
  await Deno.writeTextFile(join(backlog, "parent-of.sh"), `#!/usr/bin/env bash\necho ${EPIC}\n`);
  await Deno.writeTextFile(join(backlog, "cascade-check.sh"), "#!/usr/bin/env bash\nexit 0\n");
  await Deno.chmod(join(backlog, "parent-of.sh"), 0o755);
  await Deno.chmod(join(backlog, "cascade-check.sh"), 0o755);
  await Deno.writeTextFile(join(dir, "README.md"), "x\n");
  await git("add", "-A");
  await git("commit", "-qm", "init");
}

/** A seeded repo; `setup` shapes its branches, `fn` runs the script against it. */
export async function withRepo(setup: (r: Repo) => Promise<void>, fn: (r: Repo) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "epic-scan-" });
  try {
    const git = makeGit(dir);
    await seedRepo(dir, git);
    const exec: Repo["exec"] = async ([cmd, ...args], env = {}) => {
      const { code, stdout, stderr } = await new Deno.Command(cmd, {
        args,
        cwd: dir,
        env: { ...ISOLATED, ...env },
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return { code, out: dec.decode(stdout) + dec.decode(stderr) };
    };
    const repo: Repo = {
      dir,
      git,
      run: (runner, ...extra) => exec([...runner.argv, ...extra, "a child slice"], runner.env),
      exec,
      head: () => git("rev-parse", "--abbrev-ref", "HEAD"),
    };
    await setup(repo);
    await fn(repo);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Commit a feature.json linking `issue` on the current branch. */
export async function link(r: Repo, issue: number) {
  await Deno.writeTextFile(
    join(r.dir, ".specnaut", "feature.json"),
    JSON.stringify({ linked_issue: issue }) + "\n",
  );
  await r.git("add", ".specnaut/feature.json");
  await r.git("commit", "-qm", `plan(${issue}): link the branch to its task`);
}

/** Commit a feature.json holding `body` on a new branch `name`, then go back to main. */
export async function branchWith(r: Repo, name: string, body: string) {
  await r.git("checkout", "-q", "-b", name);
  await Deno.writeTextFile(join(r.dir, ".specnaut", "feature.json"), body);
  await r.git("add", ".specnaut/feature.json");
  await r.git("commit", "-qm", `plan: ${name}`);
  await r.git("checkout", "-q", "main");
}
export const LINK = JSON.stringify({ linked_issue: EPIC }) + "\n";
