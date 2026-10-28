// Behaviour tests for the bundled `tag.sh` (#682).
//
// `/ship` says a dirty tree stops the release, and nothing enforced it: the
// script tagged and pushed whatever HEAD was while uncommitted work sat beside
// it. These run the real script in a throwaway repo with a bare origin, and
// read the outcome from git — the tag list and the origin's refs — rather than
// from the script's own messages.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const TAG_SH = fromFileUrl(
  new URL("../../templates/core/skills/ship/scripts/tag.sh", import.meta.url),
);

type Run = { code: number; stdout: string; stderr: string };
type Repo = {
  repo: string;
  run: (...args: string[]) => Promise<Run>;
  git: (...args: string[]) => Promise<string>;
  originTags: () => Promise<string>;
};

async function withRepo(fn: (r: Repo) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "tag-sh-" });
  try {
    const repo = join(root, "repo");
    const origin = join(root, "origin.git");
    await Deno.mkdir(repo);
    const exec = async (cwd: string, cmd: string, args: string[]): Promise<Run> => {
      const r = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" })
        .output();
      return {
        code: r.code,
        stdout: new TextDecoder().decode(r.stdout),
        stderr: new TextDecoder().decode(r.stderr),
      };
    };
    const git = async (...a: string[]) => {
      const r = await exec(repo, "git", a);
      assertEquals(r.code, 0, `git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    assertEquals((await exec(root, "git", ["init", "-q", "--bare", origin])).code, 0);
    await git("init", "-q");
    await git("config", "user.email", "t@example.invalid");
    await git("config", "user.name", "t");
    await git("remote", "add", "origin", origin);
    await Deno.writeTextFile(join(repo, "f.txt"), "0\n");
    await git("add", "f.txt");
    await git("commit", "-qm", "feat: first");
    await git("push", "-q", "origin", "HEAD:refs/heads/main");
    await fn({
      repo,
      run: (...args) => exec(repo, "bash", [TAG_SH, ...args]),
      git,
      originTags: async () =>
        (await exec(root, "git", ["--git-dir", origin, "tag", "--list"])).stdout,
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("tag.sh: a modified tracked file stops the tag, names the file, pushes nothing (#682)", async () => {
  await withRepo(async ({ repo, run, git, originTags }) => {
    await Deno.writeTextFile(join(repo, "f.txt"), "uncommitted\n");
    const r = await run();
    assert(r.code !== 0, "a dirty tree must exit non-zero");
    assertStringIncludes(r.stderr, "f.txt");
    assertEquals(await git("tag", "--list"), "", "no tag is created");
    assertEquals(await originTags(), "", "nothing is pushed");
  });
});

Deno.test("tag.sh: an untracked file stops the tag too (#682)", async () => {
  await withRepo(async ({ repo, run, git }) => {
    await Deno.writeTextFile(join(repo, "stray.txt"), "x\n");
    const r = await run("--no-push");
    assert(r.code !== 0);
    assertStringIncludes(r.stderr, "stray.txt");
    assertEquals(await git("tag", "--list"), "");
  });
});

Deno.test("tag.sh: a clean tree is tagged and pushed (#682 control)", async () => {
  // The control that proves the refusal above comes from the dirty check and
  // not from a fixture that cannot tag at all.
  await withRepo(async ({ run, git, originTags }) => {
    const r = await run();
    assertEquals(r.code, 0, r.stderr);
    const tag = (await git("tag", "--list")).trim();
    assert(tag.length > 0, "a tag was created");
    assertEquals((await originTags()).trim(), tag);
  });
});
