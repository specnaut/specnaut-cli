import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { checkoutRoot } from "../../src/cli/handlers/sandbox_host_deps.ts";
import { git, initRepo } from "../helpers/git_fixture.ts";
import { callerPath, plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * The checkout a sandboxed run keeps out of sight is found by the hardened git, from a folder of
 * the checkout whose `bin` holds a git of its own; with no git to ask, by the `.git` it holds.
 */

/** `fn` given an unresolved temp folder holding `repo/sub` and a planted `repo/bin/git`. */
async function inRepo(fn: (tmp: string, repo: string, fired: string) => Promise<void>) {
  const tmp = await Deno.makeTempDir({ prefix: "checkout-root-" });
  try {
    const repo = join(tmp, "repo");
    await Deno.mkdir(join(repo, "sub"), { recursive: true });
    await initRepo(repo);
    await plantGit(join(repo, "bin"), join(tmp, "fired"));
    await fn(tmp, repo, join(tmp, "fired"));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

const POSIX_ONLY = Deno.build.os === "windows";

Deno.test({
  name: "the checkout's top is asked of a git the checkout does not supply",
  ignore: POSIX_ONLY,
  fn: () =>
    inRepo(async (_, repo, fired) => {
      const path = [join(repo, "bin"), ...callerPath()];
      assertEquals(
        await withPath(path, () => checkoutRoot(join(repo, "sub"))),
        Deno.realPathSync(repo),
      );
      assertEquals(await ran(fired), false, "the planted git ran");
    }),
});

Deno.test({
  name: "with no git to ask, the checkout is the folder holding the .git, never a narrower one",
  ignore: POSIX_ONLY,
  fn: () =>
    inRepo(async (_, repo, fired) => {
      const top = await withPath([join(repo, "bin")], () => checkoutRoot(join(repo, "sub")));
      assertEquals(top, Deno.realPathSync(repo));
      assertEquals(await ran(fired), false, "the planted git ran");
    }),
});

Deno.test({
  name: "in a submodule the checkout is the superproject's top, whether git answers or not",
  ignore: POSIX_ONLY,
  fn: () =>
    inRepo(async (_, repo, fired) => {
      // A submodule as git lays one out: a `.git` file naming its folder under the superproject's.
      const [mod, modules] = [join(repo, "sub", "mod"), join(repo, ".git", "modules")];
      await Deno.mkdir(modules);
      await git(repo, ["init", "-q", "--separate-git-dir", join(modules, "mod"), mod]);
      const own = await git(mod, ["rev-parse", "--show-toplevel"]);
      assertEquals(Deno.realPathSync(own), Deno.realPathSync(mod), "git names the submodule");
      const answered = await withPath(callerPath(), () => checkoutRoot(mod));
      const refused = await withPath([join(repo, "bin")], () => checkoutRoot(mod));
      assertEquals(answered, refused);
      assertEquals(answered, Deno.realPathSync(repo));
      assertEquals(await ran(fired), false, "the planted git ran");
    }),
});

Deno.test("outside a repository the checkout is the folder itself, resolved", () =>
  inRepo(async (tmp) => {
    assertEquals(await checkoutRoot(tmp), Deno.realPathSync(tmp));
  }));
