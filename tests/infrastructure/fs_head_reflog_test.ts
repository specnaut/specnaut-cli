import { assertEquals, assertRejects } from "@std/assert";
import { FsHeadReflog, REFTABLE } from "../../src/infrastructure/fs_head_reflog.ts";
import { git } from "../integration/verify_scripts_fixture.ts";

/**
 * HEAD's reflog as a file: a repository that keeps its refs in a reftable has none, and is refused
 * by name rather than read as one git keeps no reflog for.
 */

/** Whether this git can make a reftable repository: `--ref-format` is git 2.45's. */
const REFTABLE_GIT = await new Deno.Command("git", {
  args: ["init", "-q", "--ref-format=reftable", await Deno.makeTempDir({ prefix: "reftable-" })],
  stdout: "null",
  stderr: "null",
}).output().then((o) => o.success);

/** A repository with one commit, its refs in `format`, its config set by `config` first. */
async function repository(format: "files" | "reftable", config: string[] = []): Promise<string> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "head-reflog-" }));
  await git(root, "init", "-q", "-b", "main", `--ref-format=${format}`);
  for (let i = 0; i < config.length; i += 2) await git(root, "config", config[i], config[i + 1]);
  await git(root, "commit", "-q", "--allow-empty", "-m", "one");
  return root;
}

Deno.test({
  name: "a reftable repository's reflog is refused by name, never read as no reflog",
  ignore: !REFTABLE_GIT,
  fn: async () => {
    const reflog = await FsHeadReflog.open(await repository("reftable"));
    await assertRejects(() => reflog.headReflog(), Error, REFTABLE);
  },
});

Deno.test({
  name: "a repository git keeps no reflog for reads as none, not as a reftable",
  ignore: !REFTABLE_GIT,
  fn: async () => {
    const root = await repository("files", ["core.logAllRefUpdates", "false"]);
    assertEquals(await (await FsHeadReflog.open(root)).headReflog(), null);
  },
});
