import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * `create-new-feature.sh --issue <child>` scans every local branch for a
 * committed `.specnaut/feature.json` that links the child's epic, and reuses
 * that branch (cli#731). Two defects sat on that path:
 *
 * - the base was not excluded, so a landing that left the epic's
 *   `feature.json` on the base made the scan pick the base itself, and
 *   `git checkout -b <base>` failed every later slice;
 * - reusing the branch still ran `git checkout -b`, which fails on an existing
 *   branch unless `--allow-existing-branch` is passed — so the reuse path
 *   never succeeded as written.
 *
 * Both implementations run the same real-git scenarios: the PowerShell twin
 * carried the same scan.
 */

const CORE = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const EPIC = 7;
const CHILD = 42;

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
const PWSH_AVAILABLE = await hasPwsh();

type Runner = { name: string; argv: string[] };
const RUNNERS: Runner[] = [{
  name: "bash",
  argv: ["bash", join(CORE, "bash", "create-new-feature.sh"), "--json", "--issue", `${CHILD}`],
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
  });
}

Deno.test("epic branch scan: the PowerShell arm actually runs where it must", () => {
  if (Deno.env.get("CI") === "true") {
    assert(PWSH_AVAILABLE, "pwsh is absent on CI — the PowerShell scenarios did not run");
  }
});

type Repo = {
  dir: string;
  git: (...args: string[]) => Promise<string>;
  run: (runner: Runner) => Promise<{ code: number; out: string }>;
  head: () => Promise<string>;
};

/** Children see no global or system git config: the fixture's own config is all they read. */
const ISOLATED = {
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
async function withRepo(setup: (r: Repo) => Promise<void>, fn: (r: Repo) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "epic-scan-" });
  try {
    const git = makeGit(dir);
    await seedRepo(dir, git);
    const repo: Repo = {
      dir,
      git,
      run: async (runner) => {
        const [cmd, ...args] = runner.argv;
        const { code, stdout, stderr } = await new Deno.Command(cmd, {
          args: [...args, "a child slice"],
          cwd: dir,
          env: ISOLATED,
          stdout: "piped",
          stderr: "piped",
        }).output();
        const dec = new TextDecoder();
        return { code, out: dec.decode(stdout) + dec.decode(stderr) };
      },
      head: () => git("rev-parse", "--abbrev-ref", "HEAD"),
    };
    await setup(repo);
    await fn(repo);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Commit a feature.json linking `issue` on the current branch. */
async function link(r: Repo, issue: number) {
  await Deno.writeTextFile(
    join(r.dir, ".specnaut", "feature.json"),
    JSON.stringify({ linked_issue: issue }) + "\n",
  );
  await r.git("add", ".specnaut/feature.json");
  await r.git("commit", "-qm", `plan(${issue}): link the branch to its task`);
}

for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: neither the base carrying the epic's feature.json nor a branch merged into it is the epic's branch`, async () => {
    // A landing left the epic's link on main, and an old epic branch merged
    // into main was kept: neither is the epic's live branch.
    await withRepo(async (r) => {
      await r.git("checkout", "-q", "-b", "004-old-epic");
      await link(r, EPIC);
      await r.git("checkout", "-q", "main");
      await r.git("merge", "-q", "--ff-only", "004-old-epic");
      // main moves on: 004 is merged, not main's tip — a tip comparison would select it.
      await r.git("commit", "-q", "--allow-empty", "-m", "later work");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
      const head = await r.head();
      assert(head !== "main" && head !== "004-old-epic", `the scan selected '${head}':\n${out}`);
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: an existing epic branch is switched to, without --allow-existing-branch`, async () => {
    await withRepo(async (r) => {
      await r.git("checkout", "-q", "-b", "005-epic");
      await link(r, EPIC);
      await r.git("checkout", "-q", "main");
      await r.git("commit", "-q", "--allow-empty", "-m", "the base moves on");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} already has branch '005-epic'`);
      assertEquals(await r.head(), "005-epic");
      assertEquals(
        (await r.git("for-each-ref", "--format=%(refname:short)", "refs/heads")).split("\n").length,
        2,
      );
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: already on the epic branch, it stays there`, async () => {
    await withRepo(async (r) => {
      await r.git("checkout", "-q", "-b", "005-epic");
      await link(r, EPIC);
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `already on the epic's branch '005-epic'`);
      assertEquals(await r.head(), "005-epic");
    });
  });
}

for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: an unknown base is said, never a silent loss of the exclusion`, async () => {
    // No origin/HEAD and no init.defaultBranch: base-branch.sh exits 3.
    await withRepo(async (r) => {
      await r.git("config", "--unset", "init.defaultBranch");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, "the base branch is unknown");
    });
  });
}
