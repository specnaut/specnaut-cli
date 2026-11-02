import { assertEquals } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";
import type { Sandbox } from "./git_sandbox.ts";

/**
 * spec 051 (cli#727) SC-002 — the commands resume.md names print exactly the
 * evidence each row of its table, and each check of its provenance gate, keys
 * on. Fixtures commit the way the chain does (`plan(<id>):`, `feat(<id>):`,
 * merge-squash.md), so a green run says something about real history.
 */

const line = async (sb: Sandbox, id: number) => {
  const r = await sb.script("wip-audit.sh", `${id}@0`);
  assertEquals(r.code, 0, r.stderr);
  const [token, , sha] = r.stdout.trim().split("\n")[0].split(" ");
  return { token, sha };
};
const headsAt = async (sb: Sandbox, sha: string) =>
  (await git(sb.work, "for-each-ref", "--points-at", sha, "--format=%(refname)", "refs/heads"))
    .split("\n").filter(Boolean);
const config = async (sb: Sandbox, key: string) =>
  (await run("git", ["config", "--get", key], sb.work)).stdout.trim();
const authors = async (
  sb: Sandbox,
  name: string,
) => [
  ...new Set((await git(sb.work, "log", "--format=%ce", `main..refs/heads/${name}`)).split("\n")),
];

async function chainBranch(sb: Sandbox, name: string, id: number, code = true) {
  await git(sb.work, "switch", "--quiet", "-c", name);
  await sb.commit(`.specnaut/specs/${id}/plan.md`, "plan\n", `plan(${id}): the plan`);
  if (code) await sb.commit(`src/${id}.ts`, "x\n", `feat(${id}): part of it`);
  await git(sb.work, "switch", "--quiet", "main");
}

Deno.test("IDLE: nothing names the item — the plain plan row", async () => {
  const sb = await sandbox();
  try {
    assertEquals((await line(sb, 200)).token, "IDLE");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("IDLE with an uncommitted linked plan: the plan-stop row, its paths the only dirty ones", async () => {
  const sb = await sandbox();
  try {
    await Deno.mkdir(`${sb.work}/.specnaut/specs/201`, { recursive: true });
    await Deno.writeTextFile(`${sb.work}/.specnaut/specs/201/plan.md`, "plan\n");
    await Deno.writeTextFile(`${sb.work}/.specnaut/feature.json`, '{ "linked_issue": 201 }\n');
    assertEquals((await line(sb, 201)).token, "IDLE");
    const dirty = (await git(sb.work, "status", "--porcelain", "--untracked-files=all")).split(
      "\n",
    );
    assertEquals(dirty.sort(), ["?? .specnaut/feature.json", "?? .specnaut/specs/201/plan.md"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("ACTIVE on one clean local branch of your own: every gate check passes", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "feat-202", 202);
    const { token, sha } = await line(sb, 202);
    assertEquals(token, "ACTIVE");
    assertEquals(await headsAt(sb, sha), ["refs/heads/feat-202"]);
    assertEquals(await config(sb, "branch.feat-202.remote"), "");
    assertEquals(await authors(sb, "feat-202"), [await config(sb, "user.email")]);
    assertEquals(await git(sb.work, "status", "--porcelain"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch carrying only its committed plan is ACTIVE: the stop has passed", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "feat-203", 203, false);
    assertEquals((await line(sb, 203)).token, "ACTIVE");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("ACTIVE on origin only: no local ref points at the sha — check 1 stops", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "elsewhere", 204);
    await git(sb.work, "push", "--quiet", "origin", "elsewhere");
    await git(sb.work, "branch", "--quiet", "-D", "elsewhere");
    const { token, sha } = await line(sb, 204);
    assertEquals(token, "ACTIVE");
    assertEquals(await headsAt(sb, sha), []);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a pushed branch and its origin twin on one sha are not ambiguous", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "twin", 205);
    await git(sb.work, "push", "--quiet", "-u", "origin", "twin");
    const { sha } = await line(sb, 205);
    assertEquals(await headsAt(sb, sha), ["refs/heads/twin"]);
    assertEquals(await config(sb, "branch.twin.remote"), "origin");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("two local branches on one sha: ambiguous — check 1 stops", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "one", 206);
    await git(sb.work, "branch", "two", "one");
    const { sha } = await line(sb, 206);
    assertEquals((await headsAt(sb, sha)).length, 2);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("behind its origin twin: wip-audit names the local tip, and check 4 stops", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "shared", 207);
    await git(sb.work, "push", "--quiet", "-u", "origin", "shared");
    await git(sb.work, "switch", "--quiet", "shared");
    await sb.commit("b", "b\n", "feat(207): more, pushed by someone else");
    await git(sb.work, "push", "--quiet", "origin", "shared");
    await git(sb.work, "reset", "--quiet", "--hard", "HEAD~1");
    await git(sb.work, "switch", "--quiet", "main");
    const { token, sha } = await line(sb, 207);
    assertEquals(token, "ACTIVE");
    assertEquals(sha, await git(sb.work, "rev-parse", "refs/heads/shared"));
    assertEquals(await headsAt(sb, sha), ["refs/heads/shared"]);
    assertEquals(
      await git(sb.work, "rev-list", "--count", "refs/heads/shared..refs/remotes/origin/shared"),
      "1",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a fetched pull request: no upstream, no twin — check 5's authorship stops it", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "pr-208");
    await Deno.writeTextFile(`${sb.work}/x`, "x\n");
    await git(sb.work, "add", "x");
    const stranger = {
      GIT_COMMITTER_NAME: "stranger",
      GIT_COMMITTER_EMAIL: "stranger@example.test",
    };
    const c = await run(
      "git",
      ["commit", "--quiet", "-m", "feat(208): from a fork"],
      sb.work,
      stranger,
    );
    assertEquals(c.code, 0, c.stderr);
    await git(sb.work, "switch", "--quiet", "main");
    const { token, sha } = await line(sb, 208);
    assertEquals(token, "ACTIVE");
    assertEquals(await headsAt(sb, sha), ["refs/heads/pr-208"]);
    assertEquals(await config(sb, "branch.pr-208.remote"), "");
    assertEquals(await authors(sb, "pr-208"), ["stranger@example.test"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch tracking a pull ref: check 3 stops it", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "pr-209", 209);
    await git(sb.work, "config", "branch.pr-209.remote", "origin");
    await git(sb.work, "config", "branch.pr-209.merge", "refs/pull/9/head");
    assertEquals((await config(sb, "branch.pr-209.merge")).startsWith("refs/pull/"), true);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a refused push leaves the chain's commit on the local base: UNPUSHED, not IDLE", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "feat-210", 210);
    await git(sb.work, "merge", "--quiet", "--ff-only", "feat-210");
    assertEquals((await line(sb, 210)).token, "UNPUSHED");
    const range = await git(
      sb.work,
      "log",
      "--format=%s",
      "refs/remotes/origin/main..refs/heads/main",
    );
    assertEquals(range.split("\n"), ["feat(210): part of it", "plan(210): the plan"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the chain's landed work reads LANDED", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "feat-211", 211);
    await git(sb.work, "merge", "--quiet", "--ff-only", "feat-211");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "branch", "--quiet", "-d", "feat-211");
    assertEquals((await line(sb, 211)).token, "LANDED");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a dirty tree: git status names it, so check 6 stops", async () => {
  const sb = await sandbox();
  try {
    await chainBranch(sb, "feat-212", 212);
    await Deno.writeTextFile(`${sb.work}/stray.txt`, "x\n");
    assertEquals(await git(sb.work, "status", "--porcelain"), "?? stray.txt");
    assertEquals((await line(sb, 212)).token, "ACTIVE");
  } finally {
    await sb.cleanup();
  }
});
