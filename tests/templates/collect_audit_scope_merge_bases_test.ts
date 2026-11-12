// `collect-audit-scope.sh --base <sha> --head <sha>` lists, as FILES, every file that differs
// between the head and at least one merge base of the two. A criss-cross history has two merge
// bases, and a file the head's own merge took back to one base's content does not differ from that
// base: a scope taken from that base alone would leave it out.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { git, writeFiles } from "../scripts/explicit_head_fixture.ts";
import { scope, section } from "./collect_audit_scope_fixture.ts";

async function commit(root: string, files: Record<string, string>, message: string) {
  await writeFiles(root, files);
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

/**
 * `main` changes `g.ts` while `topic` changes `f.ts`; each branch then merges the other's commit.
 * `main` keeps both changes, and later edits `k.ts`; `topic`'s merge takes both files back to
 * their first content. The two commits are the merge bases of `main` and `topic`, and the head
 * (`topic`) differs from each in a different file.
 */
async function crissCross() {
  const root = await Deno.makeTempDir({ prefix: "audit-merge-bases-" });
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "core.autocrlf", "false");
  await commit(root, { "f.ts": "o\n", "g.ts": "o\n", "k.ts": "o\n" }, "start");
  await git(root, "checkout", "-q", "-b", "topic");
  const onTopic = await commit(root, { "f.ts": "changed on topic\n" }, "topic changes f");
  await git(root, "checkout", "-q", "main");
  const onMain = await commit(root, { "g.ts": "changed on main\n" }, "main changes g");
  await git(root, "merge", "-q", "--no-edit", "topic");
  await git(root, "checkout", "-q", "topic");
  await git(root, "merge", "-q", "--no-ff", "--no-commit", onMain);
  const head = await commit(root, { "f.ts": "o\n", "g.ts": "o\n" }, "topic merges main back");
  await git(root, "checkout", "-q", "main");
  const base = await commit(root, { "k.ts": "edited on main later\n" }, "main edits k");
  const bases = (await git(root, "merge-base", "--all", base, head)).split("\n").sort();
  assertEquals(bases, [onMain, onTopic].sort(), "the fixture has two merge bases");
  return { root, base, head };
}

Deno.test("audit scope --base: FILES are the union of the diffs from every merge base", async () => {
  const repo = await crissCross();
  const r = await scope(repo.root, ["--base", repo.base, "--head", repo.head]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(section(r.stdout, "FILES", "TOTAL_FILES"), ["f.ts", "g.ts"]);
  assertStringIncludes(r.stdout, "TOTAL_FILES: 2\n");
  assertEquals(section(r.stdout, "COMMITS", "FILES").length, 1, r.stdout);
});

Deno.test("audit scope --base: a base and a head that share no history are refused", async () => {
  const repo = await crissCross();
  await git(repo.root, "checkout", "-q", "--orphan", "unrelated");
  const other = await commit(repo.root, { "u.ts": "u\n" }, "unrelated root");
  const r = await scope(repo.root, ["--base", other, "--head", repo.head]);
  assertEquals(r.code, 2, r.stdout);
  assertStringIncludes(r.stderr, `error: --base: ${other} and the head share no history`);
  assertEquals(r.stdout, "");
});
