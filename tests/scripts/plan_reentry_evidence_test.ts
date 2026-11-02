import { assertEquals } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";
import type { Sandbox } from "./git_sandbox.ts";

/**
 * spec 055 (cli#729) — the evidence a direct `/task plan <id>` keys on before
 * it chains, run on real history: wip-audit.sh's classification, resume.md
 * § 3 check 5 (authors and committers against `git var`'s two identities) and check 8
 * (the branch's committed feature.json serves this item). resume_evidence_test
 * holds the rows resume and plan share (IDLE with a linked plan, LANDED, …).
 */

const token = async (sb: Sandbox, id: number) => {
  const r = await sb.script("wip-audit.sh", `${id}@0`);
  assertEquals(r.code, 0, r.stderr);
  return r.stdout.trim().split("\n")[0].split(" ")[0];
};
const addr = (ident: string) => ident.replace(/^.*<([^>]*)>.*$/, "$1");
/** Check 5's right side: the addresses of the identities git writes commits with. */
const me = async (sb: Sandbox) => [
  addr(await git(sb.work, "var", "GIT_AUTHOR_IDENT")),
  addr(await git(sb.work, "var", "GIT_COMMITTER_IDENT")),
];
/** Check 5: every author or committer of `<base>..<ref>` who is not the user. */
const foreign = async (sb: Sandbox, ref: string) => {
  const mine = await me(sb);
  const all = (await git(sb.work, "log", "--format=%ae%n%ce", `main..${ref}`)).split("\n");
  return [...new Set(all)].filter((a) => !mine.includes(a));
};
/** Check 8: the item the branch's committed feature.json links. */
const linked = async (sb: Sandbox, ref: string) =>
  JSON.parse(await git(sb.work, "show", `${ref}:.specnaut/feature.json`)).linked_issue;

/** A branch the way `plan` leaves it: its feature.json and plan, committed. */
async function planned(sb: Sandbox, name: string, id: number, env: Record<string, string> = {}) {
  await git(sb.work, "switch", "--quiet", "-c", name);
  const dir = `.specnaut/specs/${id}-x`;
  await Deno.mkdir(`${sb.work}/${dir}`, { recursive: true });
  await Deno.writeTextFile(`${sb.work}/${dir}/plan.md`, "plan\n");
  await Deno.writeTextFile(
    `${sb.work}/.specnaut/feature.json`,
    JSON.stringify({ feature_directory: dir, linked_issue: id }) + "\n",
  );
  await git(sb.work, "add", ".specnaut");
  const c = await run("git", ["commit", "--quiet", "-m", `plan(${id}): the plan`], sb.work, env);
  assertEquals(c.code, 0, c.stderr);
}

Deno.test("approved work on the user's own branch: ACTIVE, every committer is the user, it links the item", async () => {
  const sb = await sandbox();
  try {
    await planned(sb, "055-x", 55);
    await sb.commit("src/a.ts", "a\n", "feat(55): part of it");
    await git(sb.work, "switch", "--quiet", "main");
    assertEquals(await token(sb, 55), "ACTIVE");
    assertEquals(await foreign(sb, "refs/heads/055-x"), []);
    assertEquals(await linked(sb, "refs/heads/055-x"), 55);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("built but not landed: every planned commit is on the branch, and it still reads ACTIVE", async () => {
  // Complete work that has not landed is not complete: the chain goes on to review and merge.
  const sb = await sandbox();
  try {
    await planned(sb, "059-v", 59);
    await sb.commit("src/a.ts", "a\n", "feat(59): the first part");
    await sb.commit("src/b.ts", "b\n", "feat(59): the last part");
    await git(sb.work, "switch", "--quiet", "main");
    assertEquals(await token(sb, 59), "ACTIVE");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the issue's reproducer: an earlier slice landed, the item still open — LANDED, which chains", async () => {
  // Plan, tasks, the built slice and its review fixes, landed the way land-feature.sh
  // lands them; then new approved tasks come for the same item. wip-audit reads LANDED,
  // and the plan row chains on LANDED while the item is open (plan_reentry_test).
  const sb = await sandbox();
  try {
    await planned(sb, "060-u", 60);
    await sb.commit(".specnaut/specs/60-x/tasks.md", "- [x] T001\n", "plan(60): the tasks");
    await sb.commit("src/a.ts", "a\n", "feat(60): the slice");
    await sb.commit("src/a.ts", "a2\n", "fix(60): a review finding");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "060-u");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await git(sb.work, "branch", "--quiet", "-d", "060-u");
    assertEquals(await token(sb, 60), "LANDED");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("another item's branch whose subject names #55 reads ACTIVE for 55, and check 8 tells it apart", async () => {
  const sb = await sandbox();
  try {
    await planned(sb, "056-y", 56);
    await sb.commit("src/b.ts", "b\n", "fix(56): a follow-up to #55");
    await git(sb.work, "switch", "--quiet", "main");
    assertEquals(await token(sb, 55), "ACTIVE");
    assertEquals(await linked(sb, "refs/heads/056-y"), 56);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a fresh plan cut from someone else's branch inherits their commit, and check 5 sees it", async () => {
  const sb = await sandbox();
  try {
    // A fetched pull request: someone else's commit, no upstream.
    await git(sb.work, "switch", "--quiet", "-c", "pr-9");
    await Deno.writeTextFile(`${sb.work}/x`, "x\n");
    await git(sb.work, "add", "x");
    const stranger = { GIT_COMMITTER_NAME: "s", GIT_COMMITTER_EMAIL: "s@example.test" };
    const c = await run("git", ["commit", "--quiet", "-m", "feat: from a fork"], sb.work, stranger);
    assertEquals(c.code, 0, c.stderr);
    // `/task plan 57` from there: step 2 branches from HEAD.
    await planned(sb, "057-z", 57);
    assertEquals(await token(sb, 57), "ACTIVE");
    assertEquals(await foreign(sb, "refs/heads/057-z"), ["s@example.test"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("check 5 reads the identity git commits with, not user.email, when the two differ", async () => {
  const sb = await sandbox();
  try {
    // A session whose environment sets the committer: user.email says otherwise.
    await git(sb.work, "config", "user.email", "stale@example.test");
    await planned(sb, "058-w", 58);
    assertEquals(await foreign(sb, "refs/heads/058-w"), []);
    // user.email alone names neither the committer nor the whole truth.
    assertEquals((await me(sb)).includes("t@example.test"), true);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a rebased pull request keeps its author: check 5 reads %ae, where %ce alone sees only the user", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "pr-10");
    await Deno.writeTextFile(`${sb.work}/y`, "y\n");
    await git(sb.work, "add", "y");
    const stranger = {
      GIT_AUTHOR_NAME: "s",
      GIT_AUTHOR_EMAIL: "s@example.test",
      GIT_COMMITTER_NAME: "s",
      GIT_COMMITTER_EMAIL: "s@example.test",
    };
    const c = await run("git", ["commit", "--quiet", "-m", "feat: from a fork"], sb.work, stranger);
    assertEquals(c.code, 0, c.stderr);
    await git(sb.work, "switch", "--quiet", "main");
    await sb.commit("m", "m\n", "chore: the base moves");
    await git(sb.work, "switch", "--quiet", "pr-10");
    await git(sb.work, "rebase", "--quiet", "main");
    await planned(sb, "061-t", 61);
    const ce = (await git(sb.work, "log", "--format=%ce", "main..refs/heads/061-t")).split("\n");
    assertEquals([...new Set(ce)], ["t@example.test"], "the rebase rewrote every committer");
    assertEquals(await foreign(sb, "refs/heads/061-t"), ["s@example.test"]);
  } finally {
    await sb.cleanup();
  }
});
