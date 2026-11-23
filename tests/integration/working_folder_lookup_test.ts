import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { DenoGit } from "../../src/infrastructure/deno_git.ts";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";
import {
  GitRefused,
  UntrustedGit,
  untrustedGitEnv,
} from "../../src/infrastructure/untrusted_git.ts";
import { plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * A program started by its bare name is never found in the folder it starts in, which Windows
 * searches before the PATH and which no PATH filter covers: the runner, and every git the binary
 * starts, is handed the file the kept PATH entries hold (`programOnPath`). Each case plants the
 * program (`gh.exe`, `git.exe` on Windows) in the working folder, a repository, and runs on a PATH
 * holding only an empty folder outside it: the program is not found, and the planted one never ran.
 */

type Folders = { repo: string; outside: string };

/** `fn` given a repository holding a planted `name`, run with the PATH an empty folder outside. */
async function plantedIn(name: string, fn: (f: Folders) => Promise<void>): Promise<void> {
  const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "working-folder-" }));
  const f = { repo: join(tmp, "repo"), outside: join(tmp, "outside") };
  try {
    await Deno.mkdir(join(f.repo, ".git"), { recursive: true });
    await Deno.mkdir(f.outside);
    await plantGit(f.repo, join(tmp, "fired"), name);
    await withPath([f.outside], () => fn(f));
    assertEquals(await ran(join(tmp, "fired")), false, `the planted ${name} ran`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

const NOT_ON_PATH = (program: string) => `${program} is not on the PATH`;

Deno.test("the runner does not start a gh the working folder holds: 127", () =>
  plantedIn("gh", async ({ repo }) => {
    const out = await new DenoSubprocessRunner().run("gh", ["--version"], { cwd: repo });
    assertEquals(out, { code: 127, stdout: "", stderr: NOT_ON_PATH("gh") });
  }));

Deno.test("a read of an unvetted repository does not start the git it holds", () =>
  plantedIn("git", async ({ repo }) => {
    const git = new UntrustedGit(repo);
    await assertRejects(() => git.call("rev-parse", ["HEAD"]), GitRefused, NOT_ON_PATH("git"));
    const source = (name: string) => Deno.env.get(name);
    assertThrows(() => untrustedGitEnv(source, repo), GitRefused, NOT_ON_PATH("git"));
  }));

Deno.test("init does not start the git the project holds", () =>
  plantedIn("git", async ({ repo }) => {
    const git = new DenoGit(repo);
    assertEquals(await git.isAvailable(), false);
    await assertRejects(() => git.init(repo), Error, NOT_ON_PATH("git"));
  }));

Deno.test("the git an unvetted read starts is the absolute path the kept entries hold", () =>
  plantedIn("git", async ({ repo, outside }) => {
    await plantGit(outside, join(outside, "fired-outside"), "git");
    const source = (name: string) => Deno.env.get(name);
    const file = Deno.build.os === "windows" ? "git.exe" : "git";
    assertEquals(untrustedGitEnv(source, repo).git, join(outside, file));
    await Deno.remove(join(outside, file));
  }));

/** A program that prints the file it was started as, `$0`, and succeeds. */
async function startedAs(dir: string, name: string): Promise<string> {
  const file = join(dir, name);
  await Deno.writeTextFile(file, `#!/bin/sh\nprintf '%s' "$0"\n`, { mode: 0o755 });
  return file;
}

/**
 * The 127 above reads the same whether the lookup found nothing or the spawn did, and outside
 * Windows the spawn never looks in the working folder: those cases cannot fail there. With a
 * program on the kept entry that prints the file it ran as, a lookup that finds nothing, or
 * finds another file, fails on every platform. Windows' planted program is `whoami.exe`, which
 * prints no such thing; the cases above are its proof.
 */
const POSIX = { ignore: Deno.build.os === "windows" };

Deno.test({
  ...POSIX,
  name: "the runner starts the gh the kept entry holds, never the working folder's",
  fn: () =>
    plantedIn("gh", async ({ repo, outside }) => {
      const gh = await startedAs(outside, "gh");
      const out = await new DenoSubprocessRunner().run("gh", ["--version"], { cwd: repo });
      assertEquals(out, { code: 0, stdout: gh, stderr: "" });
    }),
});

Deno.test({
  ...POSIX,
  name: "init's reads start the git the kept entry holds, never the project's",
  fn: () =>
    plantedIn("git", async ({ repo, outside }) => {
      const git = await startedAs(outside, "git");
      assertEquals(await new DenoGit(repo).getRemoteUrl(repo, "origin"), git);
    }),
});
