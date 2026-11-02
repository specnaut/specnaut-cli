import { assertEquals } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";

/**
 * spec 051 (cli#727) SC-002 — the commands resume.md names print exactly the
 * evidence each row of its table keys on, against the real scripts. Row
 * selection is a mapping from these tokens; no row needs judgement.
 */

const first = (out: string) => out.trim().split("\n")[0].replace(/ [0-9a-f]{40}$/, " <sha>");
const headsAt = async (work: string, sha: string) =>
  (await git(work, "for-each-ref", "--points-at", sha, "--format=%(refname)", "refs/heads"))
    .split("\n").filter(Boolean);

Deno.test("IDLE, and the working tree links the item: the plan-stop row", async () => {
  const sb = await sandbox();
  try {
    await Deno.writeTextFile(`${sb.work}/.specnaut/feature.json`, '{ "linked_issue": 201 }\n');
    assertEquals(first((await sb.script("wip-audit.sh", "201@0")).stdout), "IDLE 201");
    const fj = await Deno.readTextFile(`${sb.work}/.specnaut/feature.json`);
    assertEquals(/"linked_issue"\s*:\s*201\b/.test(fj), true);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("ACTIVE on one clean local branch: the gate's first check passes", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feat-202");
    await sb.commit("a", "a\n", "feat: part (#202)");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "202@0");
    const sha = r.stdout.trim().split("\n")[0].split(" ")[2];
    assertEquals(first(r.stdout), "ACTIVE 202 <sha>");
    assertEquals(await headsAt(sb.work, sha), ["refs/heads/feat-202"]);
    assertEquals(await git(sb.work, "status", "--porcelain"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("ACTIVE on origin only: no local ref points at the sha, so the gate stops", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "elsewhere");
    await sb.commit("a", "a\n", "feat: part (#203)");
    await git(sb.work, "push", "--quiet", "origin", "elsewhere");
    await git(sb.work, "switch", "--quiet", "main");
    await git(sb.work, "branch", "--quiet", "-D", "elsewhere");
    const r = await sb.script("wip-audit.sh", "203@0");
    assertEquals(first(r.stdout), "ACTIVE 203 <sha>");
    assertEquals(await headsAt(sb.work, r.stdout.trim().split("\n")[0].split(" ")[2]), []);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("two local branches on one sha: ambiguous, the gate stops", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "one");
    await sb.commit("a", "a\n", "feat: part (#204)");
    await git(sb.work, "branch", "two");
    await git(sb.work, "switch", "--quiet", "main");
    const r = await sb.script("wip-audit.sh", "204@0");
    assertEquals((await headsAt(sb.work, r.stdout.trim().split("\n")[0].split(" ")[2])).length, 2);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a local branch behind its origin twin: someone else pushed, the gate stops", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "shared");
    await sb.commit("a", "a\n", "feat: part (#205)");
    await git(sb.work, "push", "--quiet", "-u", "origin", "shared");
    await sb.commit("b", "b\n", "feat: more (#205)");
    await git(sb.work, "push", "--quiet", "origin", "shared");
    await git(sb.work, "reset", "--quiet", "--hard", "HEAD~1");
    await git(sb.work, "switch", "--quiet", "main");
    const behind = await git(
      sb.work,
      "rev-list",
      "--count",
      "refs/heads/shared..refs/remotes/origin/shared",
    );
    assertEquals(behind, "1");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a dirty tree: git status names it, so the gate stops", async () => {
  const sb = await sandbox();
  try {
    await Deno.writeTextFile(`${sb.work}/stray.txt`, "x\n");
    assertEquals(await git(sb.work, "status", "--porcelain"), "?? stray.txt");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("UNPUSHED and LANDED are the stop rows' tokens", async () => {
  const sb = await sandbox();
  try {
    await sb.commit("a", "a\n", "feat: landed (#206)");
    await git(sb.work, "push", "--quiet", "origin", "main");
    await sb.commit("b", "b\n", "feat: local only (#207)");
    const r = await sb.script("wip-audit.sh", "206@0", "207@0");
    assertEquals(r.stdout.trim().split("\n").slice(0, 2).map(first), [
      "LANDED 206 <sha>",
      "UNPUSHED 207 <sha>",
    ]);
    const range = await git(
      sb.work,
      "log",
      "--format=%s",
      "refs/remotes/origin/main..refs/heads/main",
    );
    assertEquals(range, "feat: local only (#207)");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a ref name outside the allowlist is the kind the gate refuses", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "branch", "feat/x$(id)");
    const names = await git(sb.work, "for-each-ref", "--format=%(refname)", "refs/heads");
    const allow = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
    const refused = names.split("\n").filter((n) => !allow.test(n) || n.includes(".."));
    assertEquals(refused, ["refs/heads/feat/x$(id)"]);
    // run is the sandbox's argv runner: no shell ever sees the name.
    assertEquals(
      (await run("git", ["check-ref-format", "--branch", "feat/x$(id)"], sb.work)).code,
      0,
    );
  } finally {
    await sb.cleanup();
  }
});
