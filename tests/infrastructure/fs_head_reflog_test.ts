import { assertEquals, assertRejects } from "@std/assert";
import { FsHeadReflog, REFTABLE } from "../../src/infrastructure/fs_head_reflog.ts";
import { gitTest, REFTABLE_INIT } from "../integration/git_feature.ts";
import { git } from "../integration/verify_scripts_fixture.ts";

/**
 * HEAD's reflog as a file: a repository that keeps its refs in a reftable has none, and is refused
 * by name rather than read as one git keeps no reflog for.
 */

/** A repository with one commit, its refs in `format`, its config set by `config` first. */
async function repository(format: "files" | "reftable", config: string[] = []): Promise<string> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "head-reflog-" }));
  await git(root, "init", "-q", "-b", "main", `--ref-format=${format}`);
  for (let i = 0; i < config.length; i += 2) await git(root, "config", config[i], config[i + 1]);
  await git(root, "commit", "-q", "--allow-empty", "-m", "one");
  return root;
}

gitTest(
  REFTABLE_INIT,
  "a reftable repository's reflog is refused by name, never read as no reflog",
  async () => {
    const reflog = await FsHeadReflog.open(await repository("reftable"));
    await assertRejects(() => reflog.headReflog(), Error, REFTABLE);
  },
);

gitTest(
  REFTABLE_INIT,
  "a repository git keeps no reflog for reads as none, not as a reftable",
  async () => {
    const root = await repository("files", ["core.logAllRefUpdates", "false"]);
    assertEquals(await (await FsHeadReflog.open(root)).headReflog(), null);
  },
);

gitTest(
  REFTABLE_INIT,
  "a logs/HEAD left in a reftable repository is refused, never read as its reflog",
  async () => {
    const root = await repository("reftable");
    const z = "0".repeat(40);
    await Deno.mkdir(`${root}/.git/logs`, { recursive: true });
    await Deno.writeTextFile(`${root}/.git/logs/HEAD`, `${z} ${z} A <a@b> 0 +0000\tleft\n`);
    const reflog = await FsHeadReflog.open(root);
    await assertRejects(() => reflog.headReflog(), Error, REFTABLE);
  },
);
