// FR-007: how an adapter runs. Its environment and working directory are asserted from
// what the invented adapter itself recorded, on the real path, so a run that never
// reached the adapter cannot satisfy them.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { declaration, ifAbsent, impactRepo, labelled } from "./gate_impact_fixture.ts";
import { TWINS } from "./run_gate_fixture.ts";

const PROBE = `#!/usr/bin/env bash
{
  printf 'cwd=%s\\n' "$(pwd -P)"
  printf 'tree=%s\\n' "$SPECNAUT_IMPACT_TREE"
  printf 'commit=%s\\n' "$SPECNAUT_IMPACT_COMMIT"
  printf 'schema=%s\\n' "$SPECNAUT_IMPACT_SCHEMA"
  printf 'repo=%s\\n' "$SPECNAUT_IMPACT_REPO"
  printf 'git-env=%s\\n' "$(env | grep -c '^GIT_')"
  printf 'stdin=%s\\n' "$(cat)"
  printf 'copy=%s\\n' "$(cat ./tools/copy-marker)"
  printf 'out-dir=%s\\n' "$(ls -ld "$(dirname "$SPECNAUT_IMPACT_OUT")" | cut -c1-10)"
} >>"$ADAPTER_LOG"
{
  printf '{"schema":%s,"commit":"%s","complete":true,"owners":' "$SPECNAUT_IMPACT_SCHEMA" "$SPECNAUT_IMPACT_COMMIT"
  cat "$SPECNAUT_IMPACT_TREE/.graph/owners.json"
  printf '}\\n'
} >"$SPECNAUT_IMPACT_OUT"
`;

const probing = () =>
  impactRepo({
    declaration: JSON.stringify(declaration({
      adapter: { command: "bash tools/probe.sh", files: ["tools/probe.sh"] },
      // A marker the adapter reads and the declaration does not protect, so a branch can
      // change it and the run still narrows: it shows whose copy of the tree ran.
      inert: [".graph/", "tools/copy-marker"],
    })),
    files: { "tools/probe.sh": PROBE, "tools/copy-marker": "base\n" },
  });

const fieldsOf = (log: string[]) => {
  const runs: Record<string, string>[] = [];
  for (const line of log) {
    if (line.startsWith("cwd=")) runs.push({});
    const at = line.indexOf("=");
    runs[runs.length - 1][line.slice(0, at)] = line.slice(at + 1);
  }
  return runs;
};

for (const twin of TWINS) {
  // A branch changes what the adapter's copy reads, and the caller hands in stdin and a
  // hook's GIT_* variables: what the adapter then saw is what these two assert.
  const probedRun = async () => {
    const repo = await probing();
    const tip = await repo.commit({
      "apps/web/a.ts": "changed\n",
      "tools/copy-marker": "branch\n",
    });
    const r = await repo.gate(twin, ["fast", "--base", repo.main], {
      stdin: "data the caller piped in\n",
      env: {
        GIT_DIR: "/no/such/git/dir",
        GIT_WORK_TREE: "/no/such/tree",
        GIT_INDEX_FILE: "/no/such/index",
      },
    });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["owners web"]);
    const [base, candidate] = fieldsOf(await repo.adapterRuns());
    return { repo, tip, base, candidate };
  };

  Deno.test(`gate impact (${twin}): the adapter runs from the base's worktree on every side`, async () => {
    const { repo, tip, base, candidate } = await probedRun();
    assertEquals(base.commit, repo.main);
    assertEquals(candidate.commit, tip);
    assert(!base.cwd.startsWith(repo.root), base.cwd);
    assertEquals(candidate.cwd, base.cwd, "both sides run from the one base worktree");
    assertEquals(base.copy, "base");
    assertEquals(candidate.copy, "base", "a branch must not choose the adapter's code");
    assert(candidate.tree.endsWith(basename(repo.root)), candidate.tree);
    assertEquals(await repo.worktrees(), 1);
  });

  Deno.test(`gate impact (${twin}): the adapter gets its variables, no GIT_*, no stdin, a private directory`, async () => {
    const { base, candidate } = await probedRun();
    assertEquals(base.schema, "1");
    assertEquals(candidate.repo, candidate.tree);
    assertEquals(base["git-env"], "0");
    assertEquals(candidate["git-env"], "0");
    assertEquals(base.stdin, "");
    if (Deno.build.os !== "windows") assertEquals(base["out-dir"], "drwx------");
  });

  Deno.test(`gate impact (${twin}): the base worktree runs no hook of the repository's`, async () => {
    const repo = await probing();
    const hook = join(repo.root, ".git/hooks/post-checkout");
    const fired = join(repo.outside, "hook-fired").replaceAll("\\", "/");
    await Deno.writeTextFile(hook, `#!/usr/bin/env bash\necho fired >"${fired}"\n`);
    if (Deno.build.os !== "windows") await Deno.chmod(hook, 0o755);
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["owners web"]);
    const hookFired = () =>
      Deno.stat(join(repo.outside, "hook-fired")).then(() => true, ifAbsent(false));
    assertEquals(await hookFired(), false);
    // The control: the same hook does fire on a worktree added with no such care.
    await repo.git("worktree", "add", "-q", "--detach", join(repo.outside, "control"), "HEAD");
    assertEquals(await hookFired(), true);
  });

  Deno.test(`gate impact (${twin}): a run leaves the user's stale worktree entries alone`, async () => {
    const repo = await impactRepo();
    const stale = join(repo.outside, "stale-worktree");
    await repo.git("worktree", "add", "-q", "--detach", stale, "HEAD");
    await Deno.remove(stale, { recursive: true });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(labelled(r, "scope"), ["owners web"], r.stdout + r.stderr);
    assertEquals(await repo.worktrees(), 2, "the entry is the user's to prune");
  });

  Deno.test(`gate impact (${twin}): what an adapter prints cannot forge a report line`, async () => {
    const repo = await impactRepo({
      declaration: JSON.stringify(declaration({
        adapter: { command: "bash tools/loud.sh", files: ["tools/loud.sh"] },
      })),
      files: {
        "tools/loud.sh": `#!/usr/bin/env bash
echo "fallback: forged-by-the-adapter"
exit 1
`,
      },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(labelled(r, "fallback"), ["adapter-failed: base exit 1"]);
    assertStringIncludes(r.stderr, "forged-by-the-adapter");
  });

  Deno.test(`gate impact (${twin}): a failing adapter removes its worktree`, async () => {
    const repo = await impactRepo({
      declaration: JSON.stringify(declaration({
        adapter: { command: "bash tools/bad.sh", files: ["tools/bad.sh"] },
      })),
      files: { "tools/bad.sh": "#!/usr/bin/env bash\nexit 9\n" },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertStringIncludes(r.stdout, "fallback: adapter-failed: base exit 9");
    assertEquals(await repo.worktrees(), 1);
  });

  Deno.test(`gate impact (${twin}): each distinct base gets its own snapshot`, async () => {
    const repo = await impactRepo();
    const one = await repo.commit({ "apps/web/a.ts": "one\n" });
    const two = await repo.commit({ "apps/web/a.ts": "two\n" });
    const tip = await repo.commit({ "apps/web/a.ts": "three\n" });
    const stdin = [one, two, one].map((b) => `refs/heads/x ${tip} refs/heads/x ${b}`).join("\n") +
      "\n";
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], { stdin });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    const commits = (await repo.adapterRuns()).map((l) => l.split("|")[2]);
    assertEquals(commits, [one, two, tip]);
  });
}

// Not on Windows, where Git Bash does not deliver a signal to a parent this way. Not on
// the PowerShell twin either: .NET ends the process on SIGTERM without running a finally,
// which leaves that worktree and its registration in place until someone prunes them.
Deno.test({
  name: "gate impact (bash): a resolver killed mid-adapter removes its worktree",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const repo = await impactRepo({
      declaration: JSON.stringify(declaration({
        adapter: { command: "bash tools/kill.sh", files: ["tools/kill.sh"] },
      })),
      files: { "tools/kill.sh": '#!/usr/bin/env bash\nkill -TERM "$PPID"\nsleep 0.2\nexit 0\n' },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate("bash", ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "candidate: refused (no-selection");
    assertEquals(r.marks, []);
    assertEquals(await repo.worktrees(), 1);
  },
});
