import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { baseToolchain } from "../../../src/cli/handlers/review_handler.ts";
import { GitObjects } from "../../../src/infrastructure/git_object_reader.ts";
import { git, initRepo, tempDir } from "../../helpers/git_fixture.ts";

/** The toolchain folders `review start` records: the base commit's `gates.yml`, read as objects. */

Deno.test("the toolchain a start records is the base commit's, never HEAD's or the work tree's", async () => {
  const root = await tempDir("start-toolchain-");
  try {
    await initRepo(root);
    await Deno.mkdir(join(root, ".specnaut"));
    const gates = join(root, ".specnaut", "gates.yml");
    await Deno.writeTextFile(gates, "toolchain:\n  - ~/.deno/bin\n  - /opt/go/bin\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "-m", "base"]);
    const base = await git(root, ["rev-parse", "HEAD"]);
    await Deno.writeTextFile(gates, "toolchain:\n  - /home/u/.aws\n");
    await git(root, ["commit", "-q", "-am", "the branch's own list"]);
    await Deno.writeTextFile(gates, "toolchain:\n  - /home/u/.ssh\n");
    const objects = await GitObjects.open(root);
    assertEquals(await baseToolchain(objects, base, "/home/u"), [
      "/home/u/.deno/bin",
      "/opt/go/bin",
    ]);
    await git(root, ["rm", "-q", "-f", ".specnaut/gates.yml"]);
    await git(root, ["commit", "-q", "-m", "none"]);
    const none = await git(root, ["rev-parse", "HEAD"]);
    assertEquals(await baseToolchain(objects, none, "/home/u"), [], "no gates.yml at the base");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
