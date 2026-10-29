import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, makeRepo, runScript, sandbox } from "./hooks/hook_sandbox.ts";

/**
 * `merge-mode.sh` is the single home of the project's merge mode (plan § 5,
 * FR-002) and `base-branch.sh` of its base branch. The chain calls the
 * default reading; the landing hook calls `--strict`, which must not be
 * talked out of `manual` by a model rewriting its own working tree (§ 11 F2).
 * The default reading's file shapes live in chain_stops_test.ts, beside the
 * phase that calls it.
 */

Deno.test("merge-mode --strict: every copy must agree on auto, or it is manual", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    const wf = join(repo, ".specnaut", "workflow.yml");
    const strict = async () => (await runScript(sb, "merge-mode.sh", repo, "--strict"));

    let r = await strict();
    assertEquals([r.code, r.stdout.trim()], [0, "auto"], r.stderr);

    // Worktree flipped to manual → manual (the file is the switch).
    await Deno.writeTextFile(wf, "merge: manual\n");
    r = await strict();
    assertEquals(r.stdout.trim(), "manual");

    // Worktree rewritten to auto, but the base branch's committed copy says manual.
    await Deno.writeTextFile(wf, "merge: manual\n");
    await git(sb, repo, "commit", "-qam", "manual");
    await git(sb, repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    await git(sb, repo, "checkout", "-q", "-b", "sneaky");
    await Deno.writeTextFile(wf, "merge: auto\n");
    await git(sb, repo, "commit", "-qam", "auto again");
    r = await strict();
    assertEquals(r.stdout.trim(), "manual", "the base's committed copy must hold");
    assertStringIncludes(r.stderr, "main");

    // A second, indented or later `merge:` line counts in strict mode.
    const sb2 = await makeRepo(sb, { mode: "auto", head: "feat" });
    await Deno.writeTextFile(
      join(sb2, ".specnaut", "workflow.yml"),
      "merge: auto\n  merge: manual\n",
    );
    r = await runScript(sb, "merge-mode.sh", sb2, "--strict");
    assertEquals(r.stdout.trim(), "manual");
    // ...while the default reading takes the first top-level line, as the chain always did.
    r = await runScript(sb, "merge-mode.sh", sb2);
    assertEquals(r.stdout.trim(), "auto");

    // Unrecognised in HEAD only → manual.
    const sb3 = await makeRepo(sb, { mode: "manul", head: "feat" });
    await Deno.writeTextFile(join(sb3, ".specnaut", "workflow.yml"), "merge: auto\n");
    r = await runScript(sb, "merge-mode.sh", sb3, "--strict");
    assertEquals(r.stdout.trim(), "manual");
    assertStringIncludes(r.stderr, "manul");

    // Comment lines are not settings: the shipped file's prose says `merge: manual`.
    const sb4 = await makeRepo(sb, { mode: "auto", head: "feat" });
    await Deno.writeTextFile(
      join(sb4, ".specnaut", "workflow.yml"),
      "#   merge: manual  — stops\nmerge: auto\n",
    );
    await git(sb, sb4, "commit", "-qam", "comment");
    r = await runScript(sb, "merge-mode.sh", sb4, "--strict");
    assertEquals(r.stdout.trim(), "auto");

    // No file anywhere → auto.
    const sb5 = await makeRepo(sb, { mode: null });
    r = await runScript(sb, "merge-mode.sh", sb5, "--strict");
    assertEquals([r.code, r.stdout.trim()], [0, "auto"]);
  } finally {
    await sb.cleanup();
  }
});

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
