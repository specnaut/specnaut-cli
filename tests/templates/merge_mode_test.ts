import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { bashPath, git, makeRepo, runScript, sandbox } from "./hooks/hook_sandbox.ts";

/**
 * `merge-mode.sh` is the single home of the project's merge mode (plan § 5,
 * FR-002) and `base-branch.sh` of its base branch. The chain calls the
 * default reading; the landing hook calls `--strict`, which must not be
 * talked out of `manual` by a model rewriting its own working tree (§ 11 F2).
 * The default reading's file shapes live in merge_mode_docs_test.ts, beside the
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

    // CRLF in every copy (a Windows editor, core.autocrlf): still read as auto.
    const sb6 = await makeRepo(sb, { mode: "auto\r", head: "feat" });
    await Deno.writeTextFile(join(sb6, ".specnaut", "workflow.yml"), "merge: auto\r\n");
    r = await runScript(sb, "merge-mode.sh", sb6, "--strict");
    assertEquals([r.code, r.stdout.trim()], [0, "auto"], r.stderr);
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

Deno.test("merge-mode --strict: a base it cannot read is manual — the guard fails closed", async () => {
  // Every copy the worktree holds can be rewritten by the model it guards;
  // the base's is the one it cannot. Unknown, or naming no ref, it is not
  // there to agree — so the reading that does not push wins (cli#711).
  const sb = await sandbox();
  try {
    const unknown = await makeRepo(sb, { mode: "auto", base: null, head: "feat" });
    let r = await runScript(sb, "merge-mode.sh", unknown, "--strict");
    assertEquals([r.code, r.stdout.trim()], [0, "manual"], r.stderr);
    assertStringIncludes(r.stderr, "base branch is unknown");
    // The default reading is the chain's, not the guard's: it never reads the base.
    r = await runScript(sb, "merge-mode.sh", unknown);
    assertEquals(r.stdout.trim(), "auto");

    await git(sb, unknown, "config", "init.defaultBranch", "nowhere");
    r = await runScript(sb, "merge-mode.sh", unknown, "--strict");
    assertEquals([r.code, r.stdout.trim()], [0, "manual"], r.stderr);
    assertStringIncludes(r.stderr, "no copy of the base 'nowhere'");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("merge-mode --project <dir>: this copy reads another project's file, running none of its scripts", async () => {
  // The landing hook reads a cd target's mode with the session's own reader
  // (cli#710): a target's scripts are code the hook must never run.
  const sb = await sandbox();
  try {
    const reader = await makeRepo(sb, { mode: "auto", head: "feat" });
    const other = await makeRepo(sb, { mode: "manual", head: "feat" });
    const marker = join(sb.dir, "ran");
    for (const s of ["merge-mode.sh", "base-branch.sh"]) {
      await Deno.writeTextFile(
        join(other, ".specnaut", "scripts", "bash", s),
        `#!/usr/bin/env bash\necho ${s} >> '${bashPath(marker)}'\necho auto\n`,
      );
    }
    const script = join(reader, ".specnaut", "scripts", "bash", "merge-mode.sh");
    const run = (...a: string[]) => runScript(sb, script, reader, ...a);

    // Default and --strict alone: unchanged, the reader's own project.
    assertEquals((await run()).stdout.trim(), "auto");
    assertEquals((await run("--strict")).stdout.trim(), "auto");
    // --project, in either order: the other project's working tree, HEAD and base.
    assertEquals((await run("--strict", "--project", bashPath(other))).stdout.trim(), "manual");
    assertEquals((await run("--project", bashPath(other), "--strict")).stdout.trim(), "manual");
    assertEquals((await run("--project", bashPath(other))).stdout.trim(), "manual");
    // The other project's base holds as in its own reading: a worktree rewrite does not.
    await Deno.writeTextFile(join(other, ".specnaut", "workflow.yml"), "merge: auto\n");
    assertEquals((await run("--strict", "--project", bashPath(other))).stdout.trim(), "manual");
    assertEquals(await exists(marker), false, "a script of the other project ran");
    // A folder that cannot be read is manual; a missing value is a usage error.
    const missing = await run("--strict", "--project", bashPath(join(sb.dir, "nowhere")));
    assertEquals([missing.code, missing.stdout.trim()], [0, "manual"], missing.stderr);
    assertEquals((await run("--project")).code, 2);
  } finally {
    await sb.cleanup();
  }
});
