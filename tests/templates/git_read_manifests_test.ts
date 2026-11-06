import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "./collect_audit_scope_fixture.ts";
import { exists, gitRead, plainGit, twoCommitRepo } from "./git_read_fixture.ts";
import { run } from "./child_fixture.ts";

/**
 * `git-read.sh manifests <a> <b> <file>` picks the changed manifests itself,
 * from the globs collect-audit-scope.sh counts with, and writes their patch to
 * a file. The session's command line then holds no repository file name: a name
 * is data inside the patch, never a word a shell expands.
 */

/** A file name that runs `touch MARKER` wherever a shell expands it unquoted. */
const NAME = "$(touch MARKER).lock";

async function repoWithNamedManifest(): Promise<string> {
  const dir = await twoCommitRepo();
  await Deno.writeTextFile(`${dir}/${NAME}`, "locked 1\n");
  await Deno.writeTextFile(`${dir}/src.ts`, "export const x = 1;\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "chore: a lockfile and a source file"], dir);
  return dir;
}

Deno.test("git-read manifests writes the changed manifests' patch, and names no file", async () => {
  const dir = await repoWithNamedManifest();
  try {
    const r = await gitRead(["manifests", "HEAD~2", "HEAD", ".specnaut/logs/review/m.diff"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, "MANIFESTS: 2\n", "deno.json and the lockfile; only a count is printed");
    const patch = await Deno.readTextFile(`${dir}/.specnaut/logs/review/m.diff`);
    assertStringIncludes(patch, "+locked 1", "the lockfile's patch");
    assertStringIncludes(patch, '+{ "n": 2 }', "deno.json's patch");
    assert(!patch.includes("export const x"), "a file that is no manifest stays out");
    assert(!(await exists(`${dir}/MARKER`)), "a shell expanded the file name");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("such a file name, expanded unquoted by a shell, would run", async () => {
  const dir = await repoWithNamedManifest();
  try {
    const names = (await plainGit(["ls-files", "--", "*.lock"], dir)).stdout.trim();
    assertEquals(names, NAME, "the control needs the planted name");
    await run("bash", ["-c", `eval "echo ${names}"`], dir);
    assert(await exists(`${dir}/MARKER`), "the control must show the name is live");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read manifests writes an empty file when no manifest changed", async () => {
  const dir = await repoWithNamedManifest();
  try {
    await Deno.writeTextFile(`${dir}/src.ts`, "export const x = 2;\n");
    await git(["commit", "-am", "chore: source only"], dir);
    const r = await gitRead(["manifests", "HEAD~1", "HEAD", "out/m.diff"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, "MANIFESTS: 0\n");
    assertEquals(await Deno.readTextFile(`${dir}/out/m.diff`), "", "not the whole diff");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
