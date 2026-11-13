import { assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "./collect_audit_scope_fixture.ts";
import { gitRead, plainGit, slash, twoCommitRepo } from "./git_read_fixture.ts";

/**
 * A changed line reaches `patch`, `manifests` and `grep` whatever makes git take its file for
 * binary - a NUL near its start, or a `-diff` attribute - and a path outside the folder git-read
 * runs from reaches `names` whatever `diff.relative` says. Each case has a positive control:
 * plain git hides that line or path.
 */

/** HEAD changes a line of `deno.json` beside a NUL, and of `notes.txt`, marked `-diff`. */
async function binaryLooking(): Promise<string> {
  const dir = await twoCommitRepo();
  await Deno.writeTextFile(`${dir}/.gitattributes`, "notes.txt -diff\n");
  await Deno.writeTextFile(`${dir}/deno.json`, '{ "n": 2 }\0\nold line\n');
  await git(["add", "."], dir);
  await git(["commit", "-m", "chore: binary-looking files"], dir);
  await Deno.writeTextFile(`${dir}/deno.json`, '{ "n": 2 }\0\nchanged line\n');
  await Deno.writeTextFile(`${dir}/notes.txt`, "a changed note\n");
  await git(["commit", "-am", "chore: change them"], dir);
  return dir;
}

Deno.test("git-read patch and grep show a line git takes for binary", async () => {
  const dir = await binaryLooking();
  try {
    const plain = await plainGit(["diff", "HEAD~1", "HEAD"], dir);
    assertStringIncludes(plain.stdout, "Binary files", "the control: git hides the lines");
    const p = await gitRead(["patch", "HEAD~1", "HEAD"], dir);
    assertEquals(p.code, 0, p.stderr);
    assertStringIncludes(p.stdout, "+changed line");
    assertStringIncludes(p.stdout, "+a changed note");
    const g = await gitRead(["grep", "changed line", "HEAD"], dir);
    assertEquals(g.code, 0, g.stderr);
    assertStringIncludes(g.stdout, "HEAD:deno.json:2:changed line");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read manifests shows a manifest's line git takes for binary", async () => {
  const dir = await binaryLooking();
  const tmp = await Deno.makeTempDir({ prefix: "git-read-tmp-" });
  try {
    const r = await gitRead(["manifests", "HEAD~1", "HEAD"], dir, { TMPDIR: slash(tmp) });
    assertEquals(r.code, 0, r.stderr);
    let patch = "";
    for await (const e of Deno.readDir(tmp)) patch += await Deno.readTextFile(`${tmp}/${e.name}`);
    assertStringIncludes(patch, "+changed line");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("git-read names lists a path outside its folder under diff.relative", async () => {
  const dir = await twoCommitRepo();
  try {
    await git(["config", "diff.relative", "true"], dir);
    await Deno.mkdir(`${dir}/sub`);
    const plain = await plainGit(["diff", "--name-only", "HEAD~1", "HEAD"], `${dir}/sub`);
    assertEquals(plain.stdout, "", "the control: git lists only what is under sub/");
    const r = await gitRead(["names", "HEAD~1", "HEAD"], `${dir}/sub`);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "notes.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
