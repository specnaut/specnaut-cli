// FR-004, FR-005, FR-013: when a candidate is refused, and what each outcome exits. Each
// refusal also asserts its named cause, because exit 3 alone is satisfied by a script
// that never got that far.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { declaration, impactRepo, labelled, SUITE } from "./gate_impact_fixture.ts";
import { gateProject, gitIn, runGate, TWINS } from "./run_gate_fixture.ts";

for (const twin of TWINS) {
  Deno.test(`gate impact (${twin}): a dirty tree is refused, nothing runs`, async () => {
    const repo = await impactRepo();
    await Deno.writeTextFile(join(repo.root, "apps/web/a.ts"), "edited, not committed\n");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (dirty-tree: 1 path(s)");
    assertEquals(r.marks, []);
    assertEquals(await repo.adapterRuns(), []);
    assertEquals(labelled(r, "evidence"), ["unwritten (candidate refused)"]);
  });

  Deno.test(`gate impact (${twin}): an untracked file is refused`, async () => {
    const repo = await impactRepo();
    await Deno.writeTextFile(join(repo.root, "stray.txt"), "x\n");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (dirty-tree: 1 path(s)");
    assertEquals(r.marks, []);
  });

  Deno.test(`gate impact (${twin}): a declaration with no git repository is refused`, async () => {
    const root = await gateProject("fast_gate:\n  - echo should-not-run\n");
    await Deno.writeTextFile(join(root, ".specnaut/impact.json"), JSON.stringify(declaration()));
    const r = await runGate(twin, root, ["fast", "--base", "main"]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (not-a-repository");
    assert(!r.stdout.includes("should-not-run"), r.stdout);
  });

  Deno.test(`gate impact (${twin}): a repository with no commit is refused`, async () => {
    const root = await gateProject("fast_gate:\n  - echo should-not-run\n");
    await gitIn(root, "init", "-q");
    await Deno.writeTextFile(join(root, ".specnaut/impact.json"), JSON.stringify(declaration()));
    const r = await runGate(twin, root, ["fast", "--base", "main"]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (no-commit)");
  });

  Deno.test(`gate impact (${twin}): a project inside another repository's tree is refused`, async () => {
    const outer = await impactRepo();
    const inner = join(outer.root, "nested");
    await Deno.mkdir(inner);
    const nested = await gateProject("fast_gate:\n  - echo should-not-run\n");
    await Deno.rename(join(nested, ".specnaut"), join(inner, ".specnaut"));
    await Deno.writeTextFile(join(inner, ".specnaut/impact.json"), JSON.stringify(declaration()));
    const r = await runGate(twin, inner, ["fast", "--base", "main"]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (not-a-repository");
  });

  Deno.test(`gate impact (${twin}): a push of several trees is refused, naming them`, async () => {
    const repo = await impactRepo();
    const older = await repo.commit({ "apps/web/a.ts": "one\n" });
    const tip = await repo.commit({ "apps/web/a.ts": "two\n" });
    const stdin = [tip, older].map((sha) =>
      `refs/heads/x ${sha} refs/heads/x ${repo.main}`
    ).join("\n") + "\n";
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], { stdin });
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (several-trees: candidate");
    assertStringIncludes(r.stdout, older);
    assertEquals(r.marks, []);
  });

  Deno.test(`gate impact (${twin}): a pushed sha this repository does not hold is refused`, async () => {
    const repo = await impactRepo();
    const unknown = "b".repeat(40);
    const stdin = `refs/heads/x ${unknown} refs/heads/x ${repo.main}\n`;
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], { stdin });
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, `candidate: refused (local-sha-unknown: ${unknown})`);
    assertEquals(r.marks, []);
  });

  Deno.test(`gate impact (${twin}): a pushed sha whose tree is not the candidate is refused`, async () => {
    const repo = await impactRepo();
    await repo.commit({ "apps/web/a.ts": "one\n" });
    const stdin = `refs/heads/x ${repo.main} refs/heads/x ${repo.main}\n`;
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], { stdin });
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, `pushed ${repo.main}=`);
  });

  Deno.test(`gate impact (${twin}): two commits of one tree are one candidate`, async () => {
    const repo = await impactRepo();
    const one = await repo.commit({ "apps/web/a.ts": "one\n" });
    const same = await repo.commit();
    const stdin =
      [one, same].map((sha) => `refs/heads/x ${sha} refs/heads/x ${repo.main}`).join("\n") + "\n";
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], { stdin });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(labelled(r, "scope"), ["owners web"]);
  });

  Deno.test(`gate impact (${twin}): an adapter that dirties the candidate is refused`, async () => {
    const repo = await impactRepo({
      declaration: JSON.stringify(declaration({
        adapter: { command: "bash tools/dirty.sh", files: ["tools/dirty.sh"] },
      })),
      files: {
        "tools/dirty.sh":
          '#!/usr/bin/env bash\necho x >"$SPECNAUT_IMPACT_REPO/left-behind"\nexit 1\n',
      },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (dirty-tree");
    assertEquals(r.marks, []);
    assertEquals(await repo.worktrees(), 1);
  });

  Deno.test(`gate impact (${twin}): an adapter that answers well and dirties the tree is refused`, async () => {
    const repo = await impactRepo({
      declaration: JSON.stringify(declaration({
        adapter: { command: "bash tools/dirty.sh", files: ["tools/dirty.sh"] },
      })),
      files: {
        "tools/dirty.sh": `#!/usr/bin/env bash
echo x >"$SPECNAUT_IMPACT_REPO/left-behind"
printf '{"schema":1,"commit":"%s","complete":true,"owners":' "$SPECNAUT_IMPACT_COMMIT" >"$SPECNAUT_IMPACT_OUT"
cat "$SPECNAUT_IMPACT_TREE/.graph/owners.json" >>"$SPECNAUT_IMPACT_OUT"
printf '}' >>"$SPECNAUT_IMPACT_OUT"
`,
      },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (dirty-tree");
    assertEquals(r.marks, []);
  });

  Deno.test(`gate impact (${twin}): a command that dirties the tree after passing is exit 3`, async () => {
    const leave = "bash tools/leave.sh";
    const repo = await impactRepo({
      gates: `fast_gate:\n  - ${leave}\n`,
      files: { "tools/leave.sh": "#!/usr/bin/env bash\necho x >left-behind\n" },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stderr, "refused the candidate after running: dirty-tree");
    assertStringIncludes(r.stdout, `ran: ${leave} (exit 0)`);
    assertEquals(labelled(r, "evidence"), ["written"]);
  });

  Deno.test(`gate impact (${twin}): a command that moves HEAD after passing is exit 3`, async () => {
    const repo = await impactRepo({
      gates: "fast_gate:\n  - bash tools/move.sh\n",
      files: {
        "tools/move.sh":
          "#!/usr/bin/env bash\necho x >moved\ngit add moved\ngit commit -qm moved\n",
      },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "refused the candidate after running: tree-moved");
  });

  Deno.test(`gate impact (${twin}): a failed command that also dirties the tree stops at 1`, async () => {
    const leave = "bash tools/leave.sh";
    const repo = await impactRepo({
      gates: `fast_gate:\n  - ${leave}\n  - ${SUITE}\n`,
      declaration: JSON.stringify(declaration({ checks: [] })),
      files: { "tools/leave.sh": "#!/usr/bin/env bash\necho x >left-behind\nexit 7\n" },
    });
    await repo.commit({ "apps/web/a.ts": "changed\n" });
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 1, r.stdout);
    assertStringIncludes(r.stderr, "failed at command 1/2 (exit 7)");
    assertEquals(r.marks, []);
  });

  Deno.test(`gate impact (${twin}): a resolver that gives no answer never reads as a pass`, async () => {
    const repo = await impactRepo();
    const name = twin === "bash" ? "bash/gate-impact.sh" : "powershell/gate-impact.ps1";
    await Deno.writeTextFile(join(repo.root, ".specnaut/scripts", name), "exit 1\n");
    const r = await repo.gate(twin, ["fast", "--base", repo.main]);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stdout, "candidate: refused (no-selection");
    assertEquals(r.marks, []);
    assert(!r.stdout.includes("passed"), r.stdout);
  });

  Deno.test(`gate impact (${twin}): after --refs-stdin, a command reading stdin finds it empty and the list goes on`, async () => {
    const repo = await impactRepo({
      gates: `fast_gate:\n  - bash tools/read.sh\n  - bash tools/mark.sh after\n`,
      files: { "tools/read.sh": '#!/usr/bin/env bash\ncat >"$READ_SEEN"\n' },
    });
    const tip = await repo.commit({ "apps/web/a.ts": "x\n" });
    const seen = join(repo.outside, "read-seen");
    const r = await repo.gate(twin, ["fast", "--refs-stdin"], {
      stdin: `refs/heads/x ${tip} refs/heads/x ${repo.main}\n`,
      env: { READ_SEEN: seen.replaceAll("\\", "/") },
    });
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertEquals(await Deno.readTextFile(seen), "");
    assertEquals(r.marks, ["after unset"]);
  });
}
