import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { MAX_SCRIPT_BYTES } from "../../src/application/script_trust_ports.ts";
import { GitObjects } from "../../src/infrastructure/git_object_reader.ts";
import { commitAll, git, write } from "../integration/verify_scripts_fixture.ts";

/**
 * The reader holds no blob over the size cap in memory: a script or a lock past it is refused by
 * its path before `cat-file` reads it, and one at the cap is read whole.
 */

const SCRIPT = ".specnaut/scripts/bash/big.sh";
const LOCK = ".specnaut/installed.lock";

async function repo(files: Record<string, string>): Promise<{ root: string; head: string }> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "git-object-reader-" }));
  await git(root, "init", "-q", "-b", "main");
  await write(root, files);
  await commitAll(root, "base");
  return { root, head: (await git(root, "rev-parse", "HEAD")).trim() };
}

Deno.test("a blob at the cap is read whole", async () => {
  const { root, head } = await repo({ [SCRIPT]: "x".repeat(MAX_SCRIPT_BYTES), [LOCK]: "lock\n" });
  const reader = await GitObjects.open(root);
  const [entry] = await reader.listTree(head, ".specnaut/scripts");
  assertEquals(entry.kind === "blob" && entry.bytes.length, MAX_SCRIPT_BYTES);
  const lock = await reader.readFile(head, LOCK);
  assertEquals(lock.kind === "blob" && new TextDecoder().decode(lock.bytes), "lock\n");
});

Deno.test("a script blob over the cap is refused by its path", async () => {
  const { root, head } = await repo({ [SCRIPT]: "x".repeat(MAX_SCRIPT_BYTES + 1) });
  const reader = await GitObjects.open(root);
  await assertRejects(() => reader.listTree(head, ".specnaut/scripts"), Error, `${SCRIPT} at`);
});

Deno.test("a lock blob over the cap is refused by its path", async () => {
  const { root, head } = await repo({ [LOCK]: "x".repeat(MAX_SCRIPT_BYTES + 1) });
  const reader = await GitObjects.open(root);
  await assertRejects(() => reader.readFile(head, LOCK), Error, `${LOCK} at`);
});

Deno.test("in a project under the top, the refusal names the project's path", async () => {
  const { root, head } = await repo({ [join("app", SCRIPT)]: "x".repeat(MAX_SCRIPT_BYTES + 1) });
  const reader = await GitObjects.open(join(root, "app"));
  await assertRejects(() => reader.listTree(head, ".specnaut/scripts"), Error, `${SCRIPT} at`);
});
