import { assert, assertRejects } from "@std/assert";
import { LEAD, repoWithHighlights } from "./release_commit_fixture.ts";

/**
 * `await using` disposes only of a repository it was handed: a fixture whose
 * setup throws before returning one removes it itself, or every failing
 * setup leaves a temporary repository behind.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

Deno.test("a release fixture whose setup throws removes its temporary repository", async () => {
  let dir = "";
  await assertRejects(
    () =>
      repoWithHighlights("v1.0.0", "v1.1.0", LEAD, (d) => {
        dir = d;
        return Promise.reject(new Error("setup failed"));
      }),
    Error,
    "setup failed",
  );
  assert(dir !== "", "the setup never ran");
  assert(!(await exists(dir)), `left behind: ${dir}`);
});
