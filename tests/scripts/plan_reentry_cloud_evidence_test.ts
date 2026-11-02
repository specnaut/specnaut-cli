import { assert, assertEquals } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";
import type { Sandbox } from "./git_sandbox.ts";

/**
 * The cloud spec backend's half of plan_reentry_evidence_test (split out by
 * cli#733): the evidence `plan` and `implement` key on when the spec lives on
 * Cloud, run on real history.
 */

/** Check 8: the item the branch's committed feature.json links. */
const linked = async (sb: Sandbox, ref: string) =>
  JSON.parse(await git(sb.work, "show", `${ref}:.specnaut/feature.json`)).linked_issue;

// spec 056 (cli#730) — the cloud backend: `plan` makes no branch, `implement`
// creates it and commits the link alone, `--allow-empty` when the landed base
// already carries the same feature.json. Its branch rule reads wip-audit.sh's
// ACTIVE sha, never a bare `git show HEAD:feature.json`, which the base and every
// branch cut from it inherit.

/** Cloud `implement` on IDLE or LANDED: the branch, then the link committed alone. */
async function linkedCloud(sb: Sandbox, name: string, id: number) {
  await Deno.mkdir(`${sb.work}/.specnaut`, { recursive: true });
  await git(sb.work, "switch", "--quiet", "-c", name);
  await Deno.writeTextFile(
    `${sb.work}/.specnaut/feature.json`,
    JSON.stringify({ linked_issue: id, plan_blob: "0".repeat(40) }) + "\n",
  );
  await git(sb.work, "add", ".specnaut/feature.json");
  await git(
    sb.work,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    `plan(${id}): link the branch to its task`,
  );
}
/** wip-audit's line for <id>: its token and sha. */
const audit = async (sb: Sandbox, id: number, epoch = 0) => {
  const r = await sb.script("wip-audit.sh", `${id}@${epoch}`);
  assertEquals(r.code, 0, r.stderr);
  const [tok, , sha] = r.stdout.trim().split("\n")[0].split(" ");
  return { tok, sha };
};
const tip = (sb: Sandbox) => git(sb.work, "rev-parse", "HEAD");
const pointing = async (sb: Sandbox, sha: string) =>
  (await git(sb.work, "for-each-ref", "--format=%(refname)", "--points-at", sha, "refs/heads"))
    .split("\n");

/** Land <name> on main the way land-feature.sh does, the cloud feature.json left on the base. */
async function land(sb: Sandbox, name: string) {
  await git(sb.work, "switch", "--quiet", "main");
  await git(sb.work, "merge", "--quiet", "--ff-only", name);
  await git(sb.work, "push", "--quiet", "origin", "main");
  await git(sb.work, "branch", "--quiet", "-d", name);
}

Deno.test("cloud implement re-entered on the task's branch: ACTIVE at HEAD's tip, HEAD's branch alone — it continues, one branch", async () => {
  const sb = await sandbox();
  try {
    await linkedCloud(sb, "062-s", 62);
    await sb.commit("src/a.ts", "a\n", "feat(62): part of it");
    const a = await audit(sb, 62);
    assertEquals([a.tok, a.sha], ["ACTIVE", await tip(sb)]);
    assertEquals(await pointing(sb, a.sha), ["refs/heads/062-s"]);
    assertEquals(await linked(sb, "HEAD"), 62, "check 8");
    // A second branch at the same tip is the ambiguity § 3 check 1 refuses.
    await git(sb.work, "branch", "spare");
    assertEquals(await pointing(sb, a.sha), ["refs/heads/062-s", "refs/heads/spare"]);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("cloud implement on the base while the task's branch is unlanded: ACTIVE elsewhere — a stop naming its sha", async () => {
  const sb = await sandbox();
  try {
    await linkedCloud(sb, "063-r", 63);
    const branchTip = await tip(sb);
    await git(sb.work, "switch", "--quiet", "main");
    const a = await audit(sb, 63);
    assertEquals([a.tok, a.sha], ["ACTIVE", branchTip]);
    assert(a.sha !== (await tip(sb)), "HEAD is not that branch: never continued on");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("cloud, after a landing: the base and a fresh branch inherit the link, and neither reads ACTIVE", async () => {
  const sb = await sandbox();
  try {
    await linkedCloud(sb, "064-q", 64);
    await land(sb, "064-q");
    await git(sb.work, "switch", "--quiet", "-c", "065-other");
    await sb.commit("src/o.ts", "o\n", "feat(65): unrelated work");
    assertEquals(await linked(sb, "HEAD"), 64, "the inherited link a bare git show would trust");
    // implement's fallback task: HEAD's link counts only when wip-audit prints ACTIVE for it at HEAD's tip.
    assertEquals(
      (await audit(sb, 64)).tok,
      "LANDED",
      "so no fallback task, and a next slice gets its own branch",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("cloud next slice: the link commit is empty on the landed base's feature.json, and still reads ACTIVE", async () => {
  const sb = await sandbox();
  try {
    await linkedCloud(sb, "066-p", 66);
    await land(sb, "066-p");
    await linkedCloud(sb, "067-p", 66);
    assertEquals(
      await git(sb.work, "diff", "--name-only", "main", "HEAD"),
      "",
      "nothing changed: --allow-empty",
    );
    const a = await audit(sb, 66);
    assertEquals([a.tok, a.sha], ["ACTIVE", await tip(sb)], "the plan(66) subject names it");
  } finally {
    await sb.cleanup();
  }
});

// cli#732 — an epic is one plan and one branch: for a child, the cloud
// Re-entry reads the epic's classification, so an IDLE child of an ACTIVE epic
// adopts the epic's branch and implement continues there, never a stop.
Deno.test("cloud, a new child of an active epic: the child reads IDLE, the epic ACTIVE at its branch's tip, the one ref there", async () => {
  const sb = await sandbox();
  try {
    await linkedCloud(sb, "070-epic", 70);
    await sb.commit("src/e.ts", "e\n", "feat(71): the first child");
    const epicTip = await tip(sb);
    await git(sb.work, "switch", "--quiet", "main");
    assertEquals(
      (await audit(sb, 72)).tok,
      "IDLE",
      "the child's own classification would make a branch",
    );
    const e = await audit(sb, 70);
    assertEquals([e.tok, e.sha], ["ACTIVE", epicTip], "the epic's names its branch");
    // Re-entry adopts it; implement's ACTIVE rule then holds at HEAD's tip.
    assertEquals(await pointing(sb, e.sha), ["refs/heads/070-epic"], "§ 3 check 1: one ref");
    await git(sb.work, "switch", "--quiet", "070-epic");
    assertEquals(await tip(sb), (await audit(sb, 70)).sha);
    assertEquals(await linked(sb, "HEAD"), 70, "check 8: it links the epic");
  } finally {
    await sb.cleanup();
  }
});

// cli#733 — the epic's class decides for a child, so its UNPUSHED stops the
// run, and its own creation time is the filter, never the child's or zero.
Deno.test("cloud, a child of an epic landed but not pushed: the epic reads UNPUSHED — a stop", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("src/u.ts", "u\n", "feat(73): landed, never pushed");
    const e = await audit(sb, 73);
    assertEquals([e.tok, e.sha], ["UNPUSHED", await tip(sb)]);
    assertEquals((await audit(sb, 74)).tok, "IDLE", "the child alone would have gone on");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("cloud, the epic's own creation time: a reused number's older commit is not the epic's work", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "075-old");
    await Deno.writeTextFile(`${sb.work}/old.ts`, "o\n");
    await git(sb.work, "add", "old.ts");
    const dated = {
      GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z",
    };
    const c = await run(
      "git",
      ["commit", "--quiet", "-m", "feat(75): imported history"],
      sb.work,
      dated,
    );
    assertEquals(c.code, 0, c.stderr);
    await git(sb.work, "switch", "--quiet", "main");
    const created = Math.floor(Date.parse("2020-01-01T00:00:00Z") / 1000);
    assertEquals((await audit(sb, 75)).tok, "ACTIVE", "at epoch 0 the old commit counts");
    assertEquals((await audit(sb, 75, created)).tok, "IDLE", "at the epic's own epoch it does not");
  } finally {
    await sb.cleanup();
  }
});
