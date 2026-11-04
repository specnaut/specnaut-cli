import { assertEquals, assertStringIncludes } from "@std/assert";
import { git, makeRepo, runScript, sandbox } from "./hooks/hook_sandbox.ts";

/**
 * `merge-mode.sh` is the single home of the project's merge mode (plan § 5,
 * FR-002) and `base-branch.sh` of its base branch. The chain calls the
 * reading. Its file shapes live in merge_mode_docs_test.ts, beside the
 * phase that calls it.
 */

Deno.test("merge-mode prints only auto|manual on stdout and refuses an unknown flag", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "manual" });
    const r = await runScript(sb, "merge-mode.sh", repo);
    assertEquals(r.stdout, "manual\n");
    const bad = await runScript(sb, "merge-mode.sh", repo, "--loose");
    assertEquals([bad.code, bad.stdout], [2, ""]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("base-branch: origin/HEAD, else init.defaultBranch, else exit 3", async () => {
  const sb = await sandbox();
  try {
    const known = await makeRepo(sb, { base: "trunk", head: "feat" });
    let r = await runScript(sb, "base-branch.sh", known);
    assertEquals([r.code, r.stdout], [0, "trunk\n"]);

    const unknown = await makeRepo(sb, { base: null, head: "feat" });
    r = await runScript(sb, "base-branch.sh", unknown);
    assertEquals([r.code, r.stdout], [3, ""]);
    assertStringIncludes(r.stderr, "unknown");

    await git(sb, unknown, "config", "init.defaultBranch", "develop");
    r = await runScript(sb, "base-branch.sh", unknown);
    assertEquals([r.code, r.stdout], [0, "develop\n"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("base-branch: a name git would read as an option, or one with '..', is exit 3", async () => {
  // Every caller passes the name to git as an argument: `--exec=…` reached
  // `git rebase` through fold-fixups.sh and ran a command.
  const sb = await sandbox();
  try {
    for (const bad of ["-x", "--exec=true"]) {
      const repo = await makeRepo(sb, { base: bad, head: "feat" });
      const r = await runScript(sb, "base-branch.sh", repo);
      assertEquals([r.code, r.stdout], [3, ""], `origin/HEAD → ${bad}`);
    }
    const repo = await makeRepo(sb, { base: null, head: "feat" });
    for (const bad of ["-x", "--exec=true", "a..b", "a b", ".hidden"]) {
      await git(sb, repo, "config", "init.defaultBranch", bad);
      const r = await runScript(sb, "base-branch.sh", repo);
      assertEquals([r.code, r.stdout], [3, ""], `init.defaultBranch=${bad}`);
      assertStringIncludes(r.stderr, "not a branch name");
    }
  } finally {
    await sb.cleanup();
  }
});
