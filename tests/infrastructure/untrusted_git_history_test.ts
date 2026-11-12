import { assertEquals, assertRejects } from "@std/assert";
import { GitRefused, UntrustedGit } from "../../src/infrastructure/untrusted_git.ts";
import { plainGit, twoCommitRepo } from "../templates/git_read_fixture.ts";

/**
 * The binary's hardened git reads the objects' own history: a replace ref swaps no object, and a
 * repository holding an `info/grafts` file is refused rather than read. Plain git, the positive
 * control, is redirected by both.
 */

const count = async (git: UntrustedGit) =>
  new TextDecoder().decode(await git.run("rev-list", ["--count", "HEAD"])).trim();

Deno.test("a replace ref does not swap the commit the hardened git reads", async () => {
  const dir = await twoCommitRepo();
  try {
    assertEquals((await plainGit(["replace", "HEAD", "HEAD~1"], dir)).code, 0);
    const plain = await plainGit(["rev-list", "--count", "HEAD"], dir);
    assertEquals(plain.stdout.trim(), "1", "plain git must follow the replace ref");
    assertEquals(await count(new UntrustedGit(dir)), "2");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a repository with an info/grafts file is refused, not read", async () => {
  const dir = await twoCommitRepo();
  try {
    const head = (await plainGit(["rev-parse", "HEAD"], dir)).stdout.trim();
    await Deno.writeTextFile(`${dir}/.git/info/grafts`, `${head}\n`);
    const plain = await plainGit(["rev-list", "--count", "HEAD"], dir);
    assertEquals(plain.stdout.trim(), "1", "plain git must follow the grafts file");
    await assertRejects(() => count(new UntrustedGit(dir)), GitRefused, "info/grafts");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
