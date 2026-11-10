import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  branchWith,
  EPIC,
  LINK,
  link,
  pwshRunsOnCi,
  type Repo,
  RUNNERS,
  withRepo,
} from "./epic_repo.ts";

/**
 * The epic branch lookup's edges (cli#733), on both twins: several claimants,
 * an unreadable feature.json, a name git would read as an option, a branch at
 * the base's tip, a base only on origin, a failed switch, a dry run.
 */

pwshRunsOnCi("epic branch edges");

/** The landed base links the epic, and `005-epic` sits at its tip — checked out or not. */
function withTip(onIt: boolean, fn: (r: Repo) => Promise<void>) {
  return withRepo(async (r) => {
    await link(r, EPIC);
    await r.git("branch", "005-epic");
    await r.git("branch", "006-other");
    if (onIt) await r.git("checkout", "-q", "005-epic");
  }, fn);
}

// cli#733 — the lookup's edges, on both twins.
for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: several branches claiming the epic stop the run, listed`, async () => {
    await withRepo(async (r) => {
      await branchWith(r, "005-epic", LINK);
      await branchWith(r, "006-epic-again", LINK);
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 1, out);
      assertStringIncludes(out, `several branches link epic #${EPIC}`);
      assertStringIncludes(out, "005-epic 006-epic-again");
      // cli#734: each twin says the lookup failed, in its own words.
      assertStringIncludes(out, "the epic branch lookup failed (exit 4)");
      assertEquals(await r.head(), "main", "no branch was picked, none created");
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: an unreadable feature.json is said and skipped`, async () => {
    await withRepo(async (r) => {
      await branchWith(r, "005-broken", "{not json\n");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, "branch '005-broken' has an unreadable .specnaut/feature.json");
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: a branch named like an option is never handed to git`, async () => {
    await withRepo(async (r) => {
      await branchWith(r, "005-epic", LINK);
      await r.git("update-ref", "refs/heads/-evil", await r.git("rev-parse", "005-epic"));
      await r.git("branch", "-q", "-D", "005-epic");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: a fresh epic branch at the base's tip is reused when it is HEAD`, async () => {
    // The landed base carries the epic's link; the epic's new branch, checked out, has no commit yet.
    await withTip(true, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `already on the epic's branch '005-epic'`);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: a branch at the base's tip that is not HEAD only inherited the link`, async () => {
    // Another item's branch cut from the tip is not the epic's: it made no link its own.
    await withTip(false, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
      assert((await r.head()) !== "005-epic", out);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: being on a branch merged behind the base does not revive it`, async () => {
    await withRepo(async (r) => {
      await branchWith(r, "004-old-epic", LINK);
      await r.git("merge", "-q", "--ff-only", "004-old-epic");
      await r.git("commit", "-q", "--allow-empty", "-m", "later work");
      await r.git("checkout", "-q", "004-old-epic");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: with the base only on origin, a branch merged into it is still skipped`, async () => {
    await withRepo(async (r) => {
      // Inside .git: removed with the repo, and invisible to its work tree.
      const origin = join(r.dir, ".git", "test-origin");
      await r.git("init", "-q", "--bare", origin);
      await r.git("remote", "add", "origin", origin);
      await r.git("branch", "elsewhere");
      await branchWith(r, "004-old-epic", LINK);
      await r.git("merge", "-q", "--ff-only", "004-old-epic");
      await r.git("commit", "-q", "--allow-empty", "-m", "later work");
      await r.git("push", "-q", "origin", "main");
      await r.git("remote", "set-head", "origin", "main");
      await r.git("checkout", "-q", "elsewhere");
      await r.git("branch", "-q", "-D", "main");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
      assert(!out.includes("the base branch is unknown"), out);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: a switch that fails exits 1 and stays put`, async () => {
    await withRepo(async (r) => {
      await r.git("checkout", "-q", "-b", "005-epic");
      await link(r, EPIC);
      await Deno.writeTextFile(join(r.dir, "README.md"), "epic\n");
      await r.git("commit", "-qam", "the epic changes README");
      await r.git("checkout", "-q", "main");
      await Deno.writeTextFile(join(r.dir, "README.md"), "uncommitted\n");
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 1, out);
      assertStringIncludes(out, "Failed to switch to the epic's branch '005-epic'");
      // Named in fixed text, never in git's, which lists the blocking file (cli#752).
      assert(!out.includes("README.md"), `git's text reached the output: ${out}`);
      assertEquals(await r.head(), "main");
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: a dry run names the epic's branch and switches nothing`, async () => {
    await withRepo(async (r) => {
      await branchWith(r, "005-epic", LINK);
    }, async (r) => {
      const { code, out } = await r.run(runner, runner.dryRun);
      assertEquals(code, 0, out);
      assertStringIncludes(out, '"BRANCH_NAME":"005-epic"');
      assertStringIncludes(out, '"FEATURE_NUM":""');
      assertEquals(await r.head(), "main");
    });
  });
}
