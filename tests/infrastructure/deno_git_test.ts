import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DenoGit, listTags } from "../../src/infrastructure/deno_git.ts";
import { exists } from "../helpers/fs_exists.ts";
import { callerPath, plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * The git `specnaut init` starts in the user's project is looked up as every git the binary starts
 * is: only on PATH entries outside that project's tree (`git_path.ts`). Each project here holds a
 * `git` of its own in `bin`, first on the PATH; on Windows it leaves no mark (`plantGit`), and what
 * proves the real git ran is what it did.
 */

type Project = { dir: string; bin: string; fired: string };

/** `fn` given a project folder whose `bin` holds a planted git, removed after. */
async function inProject(fn: (p: Project) => Promise<void>): Promise<void> {
  const base = await Deno.realPath(await Deno.makeTempDir({ prefix: "deno-git-" }));
  const dir = join(base, "project");
  const p = { dir, bin: join(dir, "bin"), fired: join(base, "fired") };
  try {
    await plantGit(p.bin, p.fired);
    await fn(p);
    assertEquals(await ran(p.fired), false, "the planted git ran");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

const leftOut = (bin: string) =>
  `the entry "${bin}" was left out because it is inside the repository`;

/**
 * The fixture's own git, checked: a step that fails throws with git's cause. It reads no global or
 * system configuration, so a developer's signing or hook settings cannot fail a commit here.
 */
async function git(cwd: string, ...args: string[]): Promise<void> {
  const env = { GIT_CONFIG_GLOBAL: join(cwd, "..", "no-global-config"), GIT_CONFIG_NOSYSTEM: "1" };
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  const out = await new Deno.Command("git", { args: [...id, ...args], cwd, env, stderr: "piped" })
    .output();
  if (!out.success) throw new Error(`git ${args[0]}: ${new TextDecoder().decode(out.stderr)}`);
}

Deno.test("init, the version probe, the remote and the tags skip a git the project holds", () =>
  inProject(async ({ dir, bin }) => {
    await withPath([bin, ...callerPath()], async () => {
      assertEquals(await new DenoGit(dir).isAvailable(), true);
      await new DenoGit(dir).init(dir);
    });
    assertEquals(await exists(join(dir, ".git")), true);
    await git(dir, "remote", "add", "origin", "https://example.com/acme/my-app.git");
    await git(dir, "commit", "--allow-empty", "-q", "-m", "base");
    await git(dir, "tag", "v1.2.3");
    await withPath([bin, ...callerPath()], async () => {
      assertEquals(
        await new DenoGit(dir).getRemoteUrl(dir, "origin"),
        "https://example.com/acme/my-app.git",
      );
      assertEquals(listTags(dir), ["v1.2.3"]);
    });
  }));

Deno.test("init with no PATH entry outside the project is refused, naming the entry left out", () =>
  inProject(async ({ dir, bin }) => {
    await withPath([bin], async () => {
      await assertRejects(
        () => new DenoGit(dir).init(dir),
        Error,
        `no PATH entry outside the repository; ${leftOut(bin)}`,
      );
      assertEquals(await new DenoGit(dir).isAvailable(), false);
      assertEquals(await new DenoGit(dir).getRemoteUrl(dir, "origin"), null);
      assertEquals(listTags(dir), []);
    });
  }));

Deno.test("no git on the PATH left: init names the entry left out, the reads answer nothing", () =>
  inProject(async ({ dir, bin }) => {
    const outside = await Deno.makeTempDir({ prefix: "deno-git-empty-" });
    try {
      await withPath([bin, outside], async () => {
        await assertRejects(
          () => new DenoGit(dir).init(dir),
          Error,
          `git is not on the PATH; ${leftOut(bin)}`,
        );
        assertEquals(await new DenoGit(dir).isAvailable(), false);
        assertEquals(await new DenoGit(dir).getRemoteUrl(dir, "origin"), null);
        assertEquals(listTags(dir), []);
      });
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  }));

Deno.test("a folder init has not made yet has no tags, and reading them does not throw", async () => {
  const base = await Deno.makeTempDir({ prefix: "deno-git-" });
  const dir = join(base, "not-yet");
  try {
    // Windows fails the spawn with NotADirectory here, where POSIX says NotFound.
    assertEquals(listTags(dir), []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
