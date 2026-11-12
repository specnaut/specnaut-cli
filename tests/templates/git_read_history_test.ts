import { assertEquals } from "@std/assert";
import { libraryGit, plainGit, twoCommitRepo } from "./git_read_fixture.ts";

/**
 * The history the scripts' hardened git reads is the objects' own: a replace ref swaps no object
 * and an `info/grafts` file rewrites no commit's parents. Plain git, the positive control, is
 * redirected by both.
 */

async function count(run: typeof plainGit, dir: string): Promise<string> {
  const r = await run(["rev-list", "--count", "HEAD"], dir);
  assertEquals(r.code, 0, r.stderr);
  return r.stdout.trim();
}

Deno.test("a replace ref does not swap the commit the hardened git reads", async () => {
  const dir = await twoCommitRepo();
  try {
    assertEquals((await plainGit(["replace", "HEAD", "HEAD~1"], dir)).code, 0);
    assertEquals(await count(plainGit, dir), "1", "plain git must follow the replace ref");
    assertEquals(await count(libraryGit, dir), "2");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an info/grafts file does not cut the history the hardened git reads", async () => {
  const dir = await twoCommitRepo();
  try {
    const head = (await plainGit(["rev-parse", "HEAD"], dir)).stdout.trim();
    await Deno.writeTextFile(`${dir}/.git/info/grafts`, `${head}\n`);
    assertEquals(await count(plainGit, dir), "1", "plain git must follow the grafts file");
    assertEquals(await count(libraryGit, dir), "2");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
