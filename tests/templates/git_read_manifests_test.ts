import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "./collect_audit_scope_fixture.ts";
import { exists, gitRead, plainGit, slash, twoCommitRepo } from "./git_read_fixture.ts";
import { run } from "./child_fixture.ts";

/**
 * `git-read.sh manifests <a> <b>` picks the changed manifests itself, from the
 * globs collect-audit-scope.sh counts with, and writes their patch to a new temp
 * file outside the repository, printing its path and a count. The session's
 * command line holds no repository file name, and no path inside the work tree is
 * written: a name is data inside the patch, never a word a shell expands.
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

/**
 * `git-read.sh manifests` with TMPDIR at a fresh folder. `created` is what that
 * folder holds afterwards, read from disk; `printed` is the path's last segment,
 * so the two compare on every platform's spelling of a path.
 */
async function manifests(dir: string, a: string, b: string) {
  const tmp = await Deno.makeTempDir({ prefix: "git-read-tmp-" });
  const r = await gitRead(["manifests", a, b], dir, { TMPDIR: slash(tmp) });
  const printed = (r.stdout.match(/^MANIFESTS_FILE: (.+)$/m)?.[1] ?? "").split(/[\\/]/).pop();
  const count = r.stdout.match(/^MANIFESTS: (\d+)$/m)?.[1] ?? "";
  const created: string[] = [];
  for await (const e of Deno.readDir(tmp)) created.push(e.name);
  const patch = created.length === 1 ? await Deno.readTextFile(`${tmp}/${created[0]}`) : "";
  return { r, tmp, printed, created, count, patch };
}

Deno.test("git-read manifests writes the changed manifests' patch to a temp file, and names no file", async () => {
  const dir = await repoWithNamedManifest();
  const m = await manifests(dir, "HEAD~2", "HEAD");
  try {
    assertEquals(m.r.code, 0, m.r.stderr);
    assertEquals(m.count, "2", "deno.json and the lockfile");
    assertEquals(m.created, [m.printed], "one file, the one it printed, under TMPDIR");
    assertEquals(m.r.stdout.split("\n").length, 3, "a path and a count, nothing else");
    assertStringIncludes(m.patch, "+locked 1", "the lockfile's patch");
    assertStringIncludes(m.patch, '+{ "n": 2 }', "deno.json's patch");
    assert(!m.patch.includes("export const x"), "a file that is no manifest stays out");
    assert(!(await exists(`${dir}/MARKER`)), "a shell expanded the file name");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(m.tmp, { recursive: true });
  }
});

Deno.test("such a file name, expanded unquoted by a shell, would run", async () => {
  const dir = await repoWithNamedManifest();
  try {
    const names = (await plainGit(["ls-files", "--", "*.lock"], dir)).stdout.trim();
    assertEquals(names, NAME, "the control needs the file name");
    await run("bash", ["-c", `eval "echo ${names}"`], dir);
    assert(await exists(`${dir}/MARKER`), "the control must show the name is live");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read manifests leaves the temp file empty when no manifest changed", async () => {
  const dir = await repoWithNamedManifest();
  await Deno.writeTextFile(`${dir}/src.ts`, "export const x = 2;\n");
  await git(["commit", "-am", "chore: source only"], dir);
  const m = await manifests(dir, "HEAD~1", "HEAD");
  try {
    assertEquals(m.r.code, 0, m.r.stderr);
    assertEquals(m.count, "0");
    assertEquals(m.patch, "", "not the whole diff");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(m.tmp, { recursive: true });
  }
});

/**
 * Where the patch used to be written, a tracked link: at the file itself, or at
 * `.specnaut/logs`. The form writes nothing in the work tree, so the file each
 * link points at is left as it was.
 */
const LINKS = [
  { link: ".specnaut/logs/review/manifests.diff", target: (out: string) => `${out}/outsideFile` },
  { link: ".specnaut/logs", target: (out: string) => out },
];

/** A repo whose `link` is a tracked link into a folder outside it; the file it reaches. */
async function linkedRepo(link: string, target: (out: string) => string) {
  const dir = await repoWithNamedManifest();
  const out = await Deno.makeTempDir({ prefix: "git-read-outside-" });
  await Deno.mkdir(`${out}/review`, { recursive: true });
  await Deno.writeTextFile(`${out}/outsideFile`, "as it was\n");
  await Deno.writeTextFile(`${out}/review/manifests.diff`, "as it was\n");
  await Deno.mkdir(`${dir}/${link.slice(0, link.lastIndexOf("/"))}`, { recursive: true });
  await Deno.symlink(target(out), `${dir}/${link}`);
  await git(["add", "."], dir);
  await git(["commit", "-m", "chore: a tracked link"], dir);
  const outsideFile = link === ".specnaut/logs"
    ? `${out}/review/manifests.diff`
    : `${out}/outsideFile`;
  return { dir, out, outsideFile };
}

// Creating a link on Windows needs a privilege the machine grants, not the test.
for (const { link, target } of LINKS) {
  Deno.test({
    name: `git-read manifests leaves a file behind a tracked link at ${link} unchanged`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      const { dir, out, outsideFile } = await linkedRepo(link, target);
      try {
        const m = await manifests(dir, "HEAD~2", "HEAD");
        await Deno.remove(m.tmp, { recursive: true });
        assertEquals(m.r.code, 0, m.r.stderr);
        assertEquals(
          await Deno.readTextFile(outsideFile),
          "as it was\n",
          "written through the link",
        );
        await run("bash", ["-c", "echo overwritten > .specnaut/logs/review/manifests.diff"], dir);
        assertEquals(
          await Deno.readTextFile(outsideFile),
          "overwritten\n",
          "the link must be live",
        );
      } finally {
        await Deno.remove(dir, { recursive: true });
        await Deno.remove(out, { recursive: true });
      }
    },
  });
}
