import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EPIC, link, pwshRunsOnCi, type Repo, RUNNERS, text, withRepo } from "./epic_repo.ts";

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

pwshRunsOnCi("epic branch scan");

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
      // cli#733: no number is computed for a branch that exists, nor a remote scanned for one.
      assertStringIncludes(out, '"FEATURE_NUM":""');
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

/** `005-epic` links the epic and the base has moved on; an origin is there to fetch from. */
async function epicBranchWithOrigin(r: Repo) {
  const origin = join(r.dir, ".git", "test-origin");
  await r.git("init", "-q", "--bare", origin);
  await r.git("remote", "add", "origin", origin);
  await r.git("checkout", "-q", "-b", "005-epic");
  await link(r, EPIC);
  await r.git("checkout", "-q", "main");
  await r.git("push", "-q", "origin", "main");
}

// cli#734 — what reuse does not do, on both twins.
for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: reusing the epic's branch prints no FEATURE_NUM line as text`, async () => {
    await withRepo(epicBranchWithOrigin, async (r) => {
      const { code, out } = await r.run(text(runner));
      assertEquals(code, 0, out);
      assertStringIncludes(out, "BRANCH_NAME: 005-epic");
      assert(!out.includes("FEATURE_NUM"), out);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: reusing the epic's branch runs no git fetch`, async () => {
    await withRepo(epicBranchWithOrigin, async (r) => {
      const trace = join(r.dir, ".git", "trace.log");
      const { code, out } = await r.run({ ...runner, env: { GIT_TRACE: trace } });
      assertEquals(code, 0, out);
      assertEquals(await r.head(), "005-epic");
      const ran = await Deno.readTextFile(trace);
      assertStringIncludes(ran, "rev-parse", "the trace saw the run");
      assert(
        !/git fetch\b/.test(ran),
        ran.split("\n").filter((l) => l.includes("fetch")).join("\n"),
      );
    });
  });
}
