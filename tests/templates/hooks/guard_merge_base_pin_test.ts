import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  approve,
  git,
  type Harness,
  HARNESSES,
  makeRepo,
  payload,
  runHook,
  runScript,
  type Sandbox,
  sandbox,
} from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#718: base-branch.sh reads origin/HEAD, and `git remote set-head` moves
 * it. Under `merge: manual`, a model that repoints origin/HEAD at its own
 * branch made `git push origin main` a push "elsewhere", and, with every copy
 * it can write set to auto, turned the hold off. Each user prompt now pins the
 * base as it resolves (approve-on-prompt.sh), and guard-merge holds every
 * pinned name beside the base as it resolves now, reading their copies too.
 * The prompt also keeps the merge mode as the guard reads it: a turn that
 * began on manual stays manual, and a Stop that ends on auto asks the user.
 */

/** The Stop hook's `block` reason, or null when the stop goes through. */
async function stopReason(sb: Sandbox, h: Harness, repo: string): Promise<string | null> {
  const r = await runHook(sb, "approve-on-prompt.sh", h, await payload(h, "stop", { cwd: repo }));
  assertEquals(r.code, 0, r.stderr);
  return r.stdout === "" ? null : JSON.parse(r.stdout).reason;
}

/** A manual project on `feat`, whose prompt pinned `main`, with origin/HEAD then moved to `feat`. */
async function moved(sb: Sandbox, harness: Harness): Promise<string> {
  const repo = await makeRepo(sb, { mode: "manual", head: "feat", base: "main" });
  await git(sb, repo, "remote", "add", "origin", repo);
  await git(sb, repo, "update-ref", "refs/remotes/origin/feat", "HEAD");
  const r = await approve(sb, harness, repo, "carry on with the feature");
  assertEquals(r.code, 0, r.stderr);
  // The attack: two Bash calls the guard lets through.
  assertEquals(verdict(await bash(sb, harness, repo, "git remote set-head origin feat")), "allow");
  await git(sb, repo, "remote", "set-head", "origin", "feat");
  return repo;
}

for (const harness of HARNESSES) {
  Deno.test(`[${harness}] a repointed origin/HEAD does not release a push to the pinned base`, async () => {
    const sb = await sandbox();
    try {
      const repo = await moved(sb, harness);
      assertEquals((await runScript(sb, "base-branch.sh", repo)).stdout.trim(), "feat");
      assertEquals(verdict(await bash(sb, harness, repo, "git push origin main")), GATED[harness]);
      assertEquals(
        verdict(await bash(sb, harness, repo, "git push origin feat:main")),
        GATED[harness],
      );
      // the pin holds the base, not every branch
      assertEquals(verdict(await bash(sb, harness, repo, "git push origin topic")), "allow");
    } finally {
      await sb.cleanup();
    }
  });

  Deno.test(`[${harness}] every copy the model can write set to auto does not turn the hold off`, async () => {
    const sb = await sandbox();
    try {
      const repo = await moved(sb, harness);
      // the working tree, HEAD, and the new "base" feat all say auto; main's copy still says manual
      await Deno.writeTextFile(`${repo}/.specnaut/workflow.yml`, "merge: auto\n");
      await git(sb, repo, "commit", "-qam", "auto");
      await git(sb, repo, "update-ref", "refs/remotes/origin/feat", "HEAD");
      assertEquals(verdict(await bash(sb, harness, repo, "git push origin main")), GATED[harness]);
    } finally {
      await sb.cleanup();
    }
  });
}

for (const harness of HARNESSES) {
  Deno.test(`[${harness}] rewriting the refs the base's copies sit on keeps the turn manual, and Stop asks`, async () => {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb, { mode: "manual", head: "feat", base: "main" });
      assertEquals((await approve(sb, harness, repo, "carry on")).code, 0);
      // no set-head: every copy merge-mode reads is moved onto an auto commit
      await Deno.writeTextFile(`${repo}/.specnaut/workflow.yml`, "merge: auto\n");
      await git(sb, repo, "commit", "-qam", "auto");
      await git(sb, repo, "update-ref", "refs/heads/main", "HEAD");
      await git(sb, repo, "update-ref", "refs/remotes/origin/main", "HEAD");
      assertEquals((await runScript(sb, "merge-mode.sh", repo, "--strict")).stdout.trim(), "auto");
      assertEquals(verdict(await bash(sb, harness, repo, "git push origin main")), GATED[harness]);
      const reason = await stopReason(sb, harness, repo);
      assert(reason !== null, "a turn that began manual and ends auto must block the stop");
      assertStringIncludes(reason, "the merge mode (manual when the turn began, auto now");
    } finally {
      await sb.cleanup();
    }
  });

  Deno.test(`[${harness}] a merge on the pinned base is held, and a later prompt adds a pin, never replaces one`, async () => {
    const sb = await sandbox();
    try {
      const repo = await moved(sb, harness);
      assertEquals((await approve(sb, harness, repo, "next step")).code, 0); // pins feat too
      assertEquals(verdict(await bash(sb, harness, repo, "git push origin main")), GATED[harness]);
      await git(sb, repo, "checkout", "-q", "main");
      const r = await bash(sb, harness, repo, "git merge feat");
      assertEquals(verdict(r), GATED[harness]);
      assertStringIncludes(r.stderr, "or on main, which an earlier prompt found to be the base");
    } finally {
      await sb.cleanup();
    }
  });

  Deno.test(`[${harness}] a base unknown at the prompt stays unknown when the model creates one`, async () => {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb, { mode: "manual", head: "feat", base: null });
      await git(sb, repo, "update-ref", "refs/remotes/origin/main", "main");
      assertEquals((await approve(sb, harness, repo, "carry on")).code, 0);
      await git(sb, repo, "update-ref", "refs/remotes/origin/feat", "HEAD");
      await git(sb, repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feat");
      assertEquals((await runScript(sb, "base-branch.sh", repo)).stdout.trim(), "feat");
      const r = await bash(sb, harness, repo, "git push origin main");
      assertEquals(verdict(r), GATED[harness]);
      assertStringIncludes(r.stderr, "git push with the base branch unknown");
    } finally {
      await sb.cleanup();
    }
  });
}

Deno.test("merge-mode --strict --base: reads a pinned base's copy, skips one with no ref, refuses a bad name", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "manual", head: "feat", base: "main" });
    await Deno.writeTextFile(`${repo}/.specnaut/workflow.yml`, "merge: auto\n");
    await git(sb, repo, "commit", "-qam", "auto");
    await git(sb, repo, "update-ref", "refs/remotes/origin/feat", "HEAD");
    await git(sb, repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feat");
    const mode = async (...a: string[]) =>
      (await runScript(sb, "merge-mode.sh", repo, "--strict", ...a)).stdout.trim();
    assertEquals(await mode(), "auto");
    assertEquals(await mode("--base", "main"), "manual");
    assertEquals(await mode("--base", "gone"), "auto");
    assertEquals(await mode("--base", "--exec=x"), "manual");
    const loose = await runScript(sb, "merge-mode.sh", repo, "--base", "main");
    assertEquals([loose.code, loose.stdout], [2, ""], "--base without --strict is a usage error");
  } finally {
    await sb.cleanup();
  }
});
