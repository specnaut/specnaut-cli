import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "./collect_audit_scope_fixture.ts";
import { gitRead, plainGit, slash, twoCommitRepo } from "./git_read_fixture.ts";

/**
 * Every changed path reaches the forms that count them, whatever the repository's
 * own settings: `names` and `manifests` list a renamed file under its old name as
 * well as its new one, and a gitlink whose submodule is configured `ignore = all`.
 * Each case has a positive control: plain git, with the repository's defaults,
 * leaves that path out, so a path the form lists is one it found itself.
 */

/** HEAD moves `deno.json` out of the manifest globs: a rename git pairs on its own. */
async function renamedManifest(): Promise<string> {
  const dir = await twoCommitRepo();
  await Deno.mkdir(`${dir}/config`);
  await git(["mv", "deno.json", "config/settings.txt"], dir);
  await git(["commit", "-m", "chore: move the settings"], dir);
  return dir;
}

/**
 * HEAD moves the gitlink at `path`, whose submodule `.gitmodules` sets to
 * `ignore = all`, from one commit to another. No submodule is cloned: the
 * gitlink is an index entry, as it is in any checkout that never ran `init`.
 */
async function bumpedGitlink(path: string): Promise<string> {
  const dir = await twoCommitRepo();
  const first = (await git(["rev-parse", "HEAD~1"], dir)).trim();
  const second = (await git(["rev-parse", "HEAD"], dir)).trim();
  await Deno.writeTextFile(
    `${dir}/.gitmodules`,
    `[submodule "vendor"]\n\tpath = ${path}\n\turl = ./vendor.git\n\tignore = all\n`,
  );
  await git(["add", ".gitmodules"], dir);
  await git(["update-index", "--add", "--cacheinfo", `160000,${first},${path}`], dir);
  await git(["commit", "-m", "chore: a vendored module"], dir);
  await git(["update-index", "--cacheinfo", `160000,${second},${path}`], dir);
  await git(["commit", "-m", "chore: bump the vendored module"], dir);
  return dir;
}

const lines = (text: string) => text.split("\n").filter(Boolean).sort();

async function manifests(dir: string) {
  const tmp = await Deno.makeTempDir({ prefix: "git-read-tmp-" });
  const r = await gitRead(["manifests", "HEAD~1", "HEAD"], dir, { TMPDIR: slash(tmp) });
  // Read from the folder, not the printed path: the two spell a path differently on Windows.
  let patch = "";
  for await (const e of Deno.readDir(tmp)) patch += await Deno.readTextFile(`${tmp}/${e.name}`);
  await Deno.remove(tmp, { recursive: true });
  return { r, count: r.stdout.match(/^MANIFESTS: (\d+)$/m)?.[1] ?? "", patch };
}

Deno.test("git-read names lists a renamed file under both its names", async () => {
  const dir = await renamedManifest();
  try {
    const plain = await plainGit(["diff", "--name-only", "HEAD~1", "HEAD"], dir);
    assertEquals(lines(plain.stdout), ["config/settings.txt"], "the control: git pairs the rename");
    const r = await gitRead(["names", "HEAD~1", "HEAD"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(lines(r.stdout), ["config/settings.txt", "deno.json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read names lists a gitlink change its submodule is set to ignore", async () => {
  const dir = await bumpedGitlink("vendor/lib");
  try {
    const plain = await plainGit(["diff", "--name-only", "HEAD~1", "HEAD"], dir);
    assertEquals(plain.stdout, "", "the control: ignore = all hides the gitlink");
    const r = await gitRead(["names", "HEAD~1", "HEAD"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(lines(r.stdout), ["vendor/lib"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read manifests counts a manifest renamed out of the globs", async () => {
  const dir = await renamedManifest();
  try {
    const m = await manifests(dir);
    assertEquals(m.r.code, 0, m.r.stderr);
    assertEquals(m.count, "1", "deno.json, gone from where the globs look");
    assertStringIncludes(m.patch, '-{ "n": 2 }', "its removal, as a patch");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read manifests counts a gitlink at a manifest's path its submodule ignores", async () => {
  const dir = await bumpedGitlink("vendor/deps.lock");
  try {
    const m = await manifests(dir);
    assertEquals(m.r.code, 0, m.r.stderr);
    assertEquals(m.count, "1", "the gitlink matches *.lock");
    assertStringIncludes(m.patch, "+Subproject commit", "the bump, as a patch");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
