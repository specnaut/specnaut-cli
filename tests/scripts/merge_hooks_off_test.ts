import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Sandbox, sandbox } from "./git_sandbox.ts";
import { BRANCH, shipped } from "./remove_spec_fixture.ts";

/**
 * The merge phase rewrites a branch's history (squash, fold, rebase) and closes it out before and
 * after the landing. A branch can commit hooks that a repository-relative `core.hooksPath` names,
 * and nothing judges hooks, so no git command the phase runs may fire one: the commands its docs
 * spell, `fold-fixups.sh` and `remove-spec.sh`. Each test first shows the same hooks fire for a git
 * that leaves them on — on every platform, never skipped — so a quiet run means the hooks were off.
 */

const HOOKS = [
  "pre-commit",
  "commit-msg",
  "post-commit",
  "post-checkout",
  "pre-rebase",
  "post-rewrite",
  "pre-push",
  "reference-transaction",
];
const exists = (path: string) => Deno.stat(path).then(() => true, () => false);

/** Commits hooks that log to a marker, points core.hooksPath at them, and proves they are live. */
async function armHooks(sb: Sandbox): Promise<string> {
  const marker = join(sb.root, "hook-ran");
  const hook = `#!/bin/sh\necho "$0" >>'${bashPath(marker)}'\nexit 0\n`;
  await Deno.mkdir(join(sb.work, ".githooks"));
  for (const name of HOOKS) {
    await Deno.writeTextFile(join(sb.work, ".githooks", name), hook);
    // Windows has no mode bits: Git for Windows runs a hook by its `#!` line.
    if (Deno.build.os !== "windows") await Deno.chmod(join(sb.work, ".githooks", name), 0o755);
  }
  await git(sb.work, "add", ".githooks");
  await git(sb.work, "commit", "--quiet", "-m", "chore: commit hooks");
  await git(sb.work, "config", "core.hooksPath", ".githooks");
  await git(sb.work, "commit", "--quiet", "--allow-empty", "-m", "probe");
  assert(await exists(marker), "the branch's hooks never ran: the test proves nothing");
  await git(sb.work, "reset", "--quiet", "--soft", "HEAD~1");
  await Deno.remove(marker);
  return marker;
}

/** The prefix the merge phase's rule sentence spells, as arguments: `git <these> <subcommand>`. */
async function phasePrefix(): Promise<string[]> {
  const doc = await Deno.readTextFile(
    new URL("../../templates/core/skills/task/phases/merge.md", import.meta.url),
  );
  const m = doc.match(/is `git ((?:-c \S+ )+)<subcommand> …`/);
  assert(m, "merge.md states no git prefix for the phase");
  return m[1].trim().split(" ");
}

/** The writes the phase docs spell, run with `prefix` — the squash, a rebase, a checkout, a push. */
async function phaseWrites(sb: Sandbox, prefix: string[]) {
  const g = (...args: string[]) => git(sb.work, ...prefix, ...args);
  await g("switch", "--quiet", "-c", "feature");
  await Deno.writeTextFile(join(sb.work, "a"), "a\n");
  await g("add", "a");
  await g("commit", "--quiet", "-m", "feat(7): a");
  await g("reset", "--quiet", "--soft", "main");
  await g("commit", "--quiet", "-m", "feat(7): a, squashed");
  await g("rebase", "--quiet", "refs/remotes/origin/main");
  await g("checkout", "--quiet", "main");
  await g("branch", "-f", "probe", "refs/remotes/origin/main");
  await g("checkout", "--quiet", "feature");
  await g("push", "--quiet", "-u", "origin", "feature");
}

Deno.test("the merge phase's spelled git writes run none of the branch's hooks", async () => {
  const sb = await sandbox();
  try {
    const marker = await armHooks(sb);
    await phaseWrites(sb, await phasePrefix());
    assertEquals(await exists(marker), false, await Deno.readTextFile(marker).catch(() => ""));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the same writes without the phase's prefix do run them (the control)", async () => {
  const sb = await sandbox();
  try {
    const marker = await armHooks(sb);
    await phaseWrites(sb, []);
    const ran = await Deno.readTextFile(marker);
    for (const name of ["pre-commit", "post-checkout", "pre-push"]) {
      assert(ran.includes(name), `${name} did not run: ${ran}`);
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("fold-fixups.sh folds an epic's fixups with none of the branch's hooks", async () => {
  const sb = await sandbox();
  try {
    const marker = await armHooks(sb);
    await git(sb.work, "switch", "--quiet", "-c", "epic");
    const t01 = await sb.commit("a", "one\n", "feat(T01): a (#51)", "Epic: #50");
    await sb.commit("b", "two\n", "feat(T02): b (#52)", "Epic: #50");
    await Deno.writeTextFile(`${sb.work}/a`, "one, fixed\n");
    await git(sb.work, "commit", "--quiet", "-am", "x", `--fixup=${t01}`);
    await Deno.remove(marker); // building the fixture with a plain git ran them
    const r = await sb.script("fold-fixups.sh");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await git(sb.work, "rev-list", "--count", "main..HEAD"), "2");
    assertEquals(await exists(marker), false, await Deno.readTextFile(marker).catch(() => ""));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("remove-spec.sh commits and pushes the removal with none of the branch's hooks", async () => {
  const sb = await shipped();
  try {
    const marker = await armHooks(sb);
    await git(sb.work, "-c", "core.hooksPath=/dev/null", "push", "--quiet", "origin", "main");
    const r = await sb.script("remove-spec.sh", BRANCH);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await exists(marker), false, await Deno.readTextFile(marker).catch(() => ""));
  } finally {
    await sb.cleanup();
  }
});
