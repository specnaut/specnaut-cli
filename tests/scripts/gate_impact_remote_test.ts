// base-branch on both twins against a real remote: the origin/HEAD route, its precedence over
// the configured default, and a name it refuses to hand to git.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { impactRepo, type Repo } from "./gate_impact_fixture.ts";
import { spawn, type Twin, TWINS } from "./run_gate_fixture.ts";

const baseBranch = (twin: Twin, repo: Repo) =>
  spawn(
    twin === "bash"
      ? ["bash", bashPath(join(repo.root, ".specnaut/scripts/bash/base-branch.sh"))]
      : [
        "pwsh",
        "-NoProfile",
        "-File",
        join(repo.root, ".specnaut/scripts/powershell/base-branch.ps1"),
      ],
    repo.root,
  );

for (const twin of TWINS) {
  Deno.test(`base-branch (${twin}): origin/HEAD names the base, over the configured default`, async () => {
    const repo = await impactRepo();
    await repo.withOrigin();
    await repo.git("config", "init.defaultBranch", "configured-default");
    const r = await baseBranch(twin, repo);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout.trim(), "main");
  });

  Deno.test(`base-branch (${twin}): a name git would read as an option is exit 3, never printed`, async () => {
    const repo = await impactRepo();
    await repo.withOrigin();
    await repo.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/--exec=x");
    const r = await baseBranch(twin, repo);
    assertEquals(r.code, 3, r.stdout);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "is not a branch name");
  });

  Deno.test(`base-branch (${twin}): neither origin/HEAD nor a configured default is exit 3`, async () => {
    const repo = await impactRepo();
    await repo.git("config", "--unset", "init.defaultBranch");
    const r = await baseBranch(twin, repo);
    assertEquals(r.code, 3, r.stdout);
    assertStringIncludes(r.stderr, "unknown");
  });
}
