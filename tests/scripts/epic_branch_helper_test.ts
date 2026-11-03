import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  branchWith,
  EPIC,
  EPIC_BRANCH_SH,
  LINK,
  link,
  pwshRunsOnCi,
  type Repo,
  RUNNERS,
  withRepo,
} from "./epic_repo.ts";

/**
 * The epic branch lookup's second round of edges (cli#734): epic-branch.sh
 * called directly — its own exit codes and warnings — and, on both twins, the
 * stale local base, the fresh branch planning another item, an over-long name.
 */

pwshRunsOnCi("epic branch helper");

const lookup = (r: Repo, env?: Record<string, string>) =>
  r.exec(["bash", EPIC_BRANCH_SH, `${EPIC}`], env);

Deno.test("epic-branch.sh: several branches linking the epic exit 4, listed", async () => {
  await withRepo(async (r) => {
    await branchWith(r, "005-epic", LINK);
    await branchWith(r, "006-epic-again", LINK);
  }, async (r) => {
    const { code, out } = await lookup(r);
    assertEquals(code, 4, out);
    assertStringIncludes(
      out,
      `several branches link epic #${EPIC} - not picking one: 005-epic 006-epic-again`,
    );
  });
});

Deno.test("epic-branch.sh: a branch dropped by the name filter is said, not skipped silently", async () => {
  await withRepo(async (r) => {
    await r.git("update-ref", "refs/heads/-evil", await r.git("rev-parse", "HEAD"));
  }, async (r) => {
    const { code, out } = await lookup(r);
    assertEquals(code, 0, out);
    assertStringIncludes(out, "branch '-evil' has a name git could read as an option - skipped");
  });
});

Deno.test({
  name: "epic-branch.sh: without jq it stops, rather than report no branch and mint a second one",
  // The PATH below is built from symlinks, which Windows hands out to admins only.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withRepo(async (r) => {
      await branchWith(r, "005-epic", LINK);
    }, async (r) => {
      const bin = join(r.dir, ".git", "bin-without-jq");
      await Deno.mkdir(bin);
      for (const tool of ["bash", "git", "dirname", "cat"]) {
        const { out } = await r.exec(["bash", "-c", `command -v ${tool}`]);
        await Deno.symlink(out.trim(), join(bin, tool));
      }
      const { code, out } = await r.exec([join(bin, "bash"), EPIC_BRANCH_SH, `${EPIC}`], {
        PATH: bin,
      });
      assertEquals(code, 1, out);
      assertStringIncludes(out, "needs jq, which is not installed");
    });
  },
});

/** The fixture's premise: the local base really is behind origin's. */
async function assertStaleMain(r: Repo) {
  const behind = await r.git("rev-list", "--count", "main..origin/main");
  assert(Number(behind) > 0, "local main is not behind origin/main");
}

for (const runner of RUNNERS) {
  Deno.test(`epic branch scan [${runner.name}]: a branch landed on origin but not on a stale local base is still skipped`, async () => {
    await withRepo(async (r) => {
      const origin = join(r.dir, ".git", "test-origin");
      await r.git("init", "-q", "--bare", origin);
      await r.git("remote", "add", "origin", origin);
      await r.git("push", "-q", "origin", "main");
      await r.git("remote", "set-head", "origin", "main");
      await branchWith(r, "004-old-epic", LINK);
      // Landed from elsewhere: origin/main has it, the local main does not.
      await r.git("push", "-q", "origin", "004-old-epic:main");
      await r.git("fetch", "-q", "origin");
      await assertStaleMain(r);
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
      assert((await r.head()) !== "004-old-epic", out);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: HEAD at origin's tip, ahead of a stale local base, is the epic's fresh branch`, async () => {
    await withRepo(async (r) => {
      const origin = join(r.dir, ".git", "test-origin");
      await r.git("init", "-q", "--bare", origin);
      await r.git("remote", "add", "origin", origin);
      await r.git("push", "-q", "origin", "main");
      await r.git("remote", "set-head", "origin", "main");
      // A landing elsewhere left the epic's link on origin/main; the local main never pulled it.
      await branchWith(r, "landed", LINK);
      await r.git("push", "-q", "origin", "landed:main");
      await r.git("fetch", "-q", "origin");
      await r.git("branch", "-q", "-D", "landed");
      await r.git("checkout", "-q", "-b", "005-epic", "origin/main");
      await assertStaleMain(r);
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `already on the epic's branch '005-epic'`);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: HEAD at the base's tip planning another item is not the epic's`, async () => {
    await withRepo(async (r) => {
      await link(r, EPIC);
      await r.git("checkout", "-q", "-b", "006-other");
      // Its working tree links another item: the base's committed link is not its own.
      await Deno.writeTextFile(
        join(r.dir, ".specnaut", "feature.json"),
        JSON.stringify({ linked_issue: 99 }) + "\n",
      );
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 0, out);
      assertStringIncludes(out, `epic #${EPIC} has no branch yet`);
      assert((await r.head()) !== "006-other", out);
    });
  });

  Deno.test(`epic branch scan [${runner.name}]: an epic branch over 244 bytes is refused, never truncated into a dash name`, async () => {
    const long = `005-${"a".repeat(246)}`;
    await withRepo(async (r) => {
      await branchWith(r, "short", LINK);
      // Packed, so it needs no ref file: a 250-byte one exceeds MAX_PATH on Windows.
      const sha = await r.git("rev-parse", "short");
      await r.git("branch", "-q", "-D", "short");
      await Deno.writeTextFile(join(r.dir, ".git", "packed-refs"), `${sha} refs/heads/${long}\n`);
      // Without it, Git for Windows fails on a ref name past MAX_PATH, even a packed one.
      await r.git("config", "core.longpaths", "true");
      assertEquals(
        await r.git("for-each-ref", "--format=%(refname:short)", "refs/heads/005-*"),
        long,
      );
    }, async (r) => {
      const { code, out } = await r.run(runner);
      assertEquals(code, 1, out);
      assertStringIncludes(out, "over GitHub's 244-byte limit");
      assertEquals(await r.head(), "main");
      assertEquals(await r.git("for-each-ref", "--format=%(refname:short)", "refs/heads/-*"), "");
    });
  });
}
