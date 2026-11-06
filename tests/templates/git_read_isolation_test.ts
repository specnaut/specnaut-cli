import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER } from "@std/path";
import { git } from "./collect_audit_scope_fixture.ts";
import {
  gitRead,
  plainGit,
  Plants,
  signedCommit,
  slash,
  twoCommitRepo,
} from "./git_read_fixture.ts";

/**
 * The git library keeps a read inside the one repository and the objects it
 * already holds: no submodule is entered, no missing object is fetched, and on a
 * git too old to forbid the fetch, a repository that could trigger one is refused.
 * The last case runs every form with every planted program in place.
 */

/** `dir` with a submodule `sub` holding `needle` in a file, recorded in two commits. */
async function withSubmodule(dir: string, root: string): Promise<void> {
  const sub = `${root}/sub-origin`;
  await Deno.mkdir(sub);
  await git(["init", "-b", "main"], sub);
  await Deno.writeTextFile(`${sub}/inside.txt`, "needle\n");
  await git(["add", "."], sub);
  await git(["commit", "-m", "chore: inside the submodule"], sub);
  await git(["-c", "protocol.file.allow=always", "submodule", "add", slash(sub), "sub"], dir);
  await git(["commit", "-m", "chore: add the submodule"], dir);
  await Deno.writeTextFile(`${sub}/inside.txt`, "needle moved\n");
  await git(["commit", "-am", "chore: submodule subject two"], sub);
  await git(["-C", "sub", "pull", "-q", "origin", "main"], dir);
  await git(["commit", "-am", "chore: move the submodule"], dir);
}

Deno.test("git-read never enters a submodule, whatever the repository sets", async () => {
  const dir = await twoCommitRepo();
  const root = await Deno.makeTempDir({ prefix: "git-read-sub-" });
  try {
    await withSubmodule(dir, root);
    await git(["config", "submodule.recurse", "true"], dir);
    await git(["config", "diff.submodule", "log"], dir);
    const grep = await plainGit(["grep", "-F", "-e", "needle", "HEAD"], dir);
    assertStringIncludes(grep.stdout, "sub/inside.txt", "the recursion must be live");
    const diff = await plainGit(["diff", "HEAD~1", "HEAD"], dir);
    assertStringIncludes(diff.stdout, "submodule subject two", "the submodule log must be live");

    const g = await gitRead(["grep", "needle", "HEAD"], dir);
    assert(!g.stdout.includes("sub/inside.txt"), `grep entered the submodule:\n${g.stdout}`);
    const d = await gitRead(["patch", "HEAD~1", "HEAD"], dir);
    assertEquals(d.code, 0, d.stderr);
    assertStringIncludes(d.stdout, "Subproject commit", "the patch form must have run");
    assert(
      !d.stdout.includes("submodule subject two"),
      `patch read the submodule's log:\n${d.stdout}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

/** Turns `dir` into a partial clone missing HEAD's `notes.txt`, its fetch a planted program. */
async function promisor(dir: string, p: Plants): Promise<void> {
  const blob = (await git(["rev-parse", "HEAD:notes.txt"], dir)).trim();
  await Deno.remove(`${dir}/.git/objects/${blob.slice(0, 2)}/${blob.slice(2)}`);
  await git(["config", "core.repositoryformatversion", "1"], dir);
  await git(["config", "extensions.partialClone", "origin"], dir);
  await git(["config", "remote.origin.url", slash(`${p.dir}/nowhere`)], dir);
  await git(["config", "remote.origin.promisor", "true"], dir);
  await git(["config", "remote.origin.uploadpack", await p.plant("upload-pack")], dir);
}

Deno.test("git-read never fetches a missing object from a promisor remote", async () => {
  const dir = await twoCommitRepo();
  const p = await Plants.create();
  try {
    await promisor(dir, p);
    await plainGit(["diff", "HEAD~1", "HEAD"], dir);
    assertEquals(await p.ran(), ["upload-pack"], "the lazy fetch must be live");
    const r = await gitRead(["patch", "HEAD~1", "HEAD", "notes.txt"], dir);
    assert(r.code !== 0, "the object is missing; reading it cannot succeed");
    assertEquals(await p.ran(), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await p.remove();
  }
});

/** A `git` first on PATH that reports `version` and runs the real git for the rest. */
async function olderGit(root: string, version: string): Promise<Record<string, string>> {
  const real = await new Deno.Command("bash", { args: ["-c", "command -v git"] }).output();
  const path = new TextDecoder().decode(real.stdout).trim();
  await Deno.writeTextFile(
    `${root}/git`,
    `#!/usr/bin/env bash\n[ "$1" = version ] && { echo "git version ${version}"; exit 0; }\n` +
      `exec "${path}" "$@"\n`,
  );
  await Deno.chmod(`${root}/git`, 0o755);
  return { PATH: `${root}${DELIMITER}${Deno.env.get("PATH") ?? ""}` };
}

// The version branch is bash; a `git` script ahead of PATH is the POSIX way to fake one.
Deno.test({
  name: "git-read refuses a promisor repository on a git that predates --no-lazy-fetch",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await twoCommitRepo();
    const p = await Plants.create();
    const shim = await Deno.makeTempDir({ prefix: "git-read-shim-" });
    try {
      const env = await olderGit(shim, "2.43.0");
      const plain = await gitRead(["names", "HEAD~1", "HEAD"], dir, env);
      assertEquals(plain.code, 0, `an ordinary repository still reads: ${plain.stderr}`);
      assertStringIncludes(plain.stdout, "notes.txt");
      await promisor(dir, p);
      const r = await gitRead(["patch", "HEAD~1", "HEAD", "notes.txt"], dir, env);
      assertEquals(r.code, 2, r.stderr);
      assertStringIncludes(r.stderr, "promisor remote");
      assertEquals(await p.ran(), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(shim, { recursive: true });
      await p.remove();
    }
  },
});

Deno.test("every git-read form runs with every planted program in place, and none of them runs", async () => {
  const dir = await twoCommitRepo();
  const p = await Plants.create();
  try {
    for (const kind of ["openpgp", "ssh", "x509"] as const) await signedCommit(dir, kind);
    await Deno.writeTextFile(`${dir}/.gitattributes`, "*.txt diff=conv\n*.bin diff=ext\n");
    await Deno.writeTextFile(`${p.dir}/allowed`, "");
    const config: [string, string][] = [
      ["core.fsmonitor", await p.plant("fsmonitor")],
      ["diff.conv.textconv", await p.plant("textconv")],
      ["diff.ext.command", await p.plant("external-diff")],
      ["diff.external", await p.plant("diff-external")],
      ["core.pager", await p.plant("pager")],
      ["gpg.program", await p.plant("gpg")],
      ["gpg.ssh.program", await p.plant("gpg-ssh")],
      ["gpg.x509.program", await p.plant("gpg-x509")],
      ["gpg.ssh.allowedSignersFile", slash(`${p.dir}/allowed`)],
      ["log.showSignature", "true"],
      ["format.pretty", "format:%G? %s"],
      ["core.hooksPath", slash(p.dir)],
    ];
    for (const [k, v] of config) await git(["config", k, v], dir);
    for (const hook of ["post-index-change", "reference-transaction"]) {
      await p.plant(hook, `${p.dir}/${hook}`);
    }
    const forms = [
      ["names", "HEAD~1", "HEAD"],
      ["patch", "HEAD~1", "HEAD"],
      ["log", "HEAD~1..HEAD"],
      ...["openpgp", "ssh", "x509"].flatMap((k) => [
        ["log", `signed-${k}`, "1"],
        ["show", `signed-${k}`, "--stat"],
        ["show", `signed-${k}`, "--no-patch"],
      ]),
      ["files"],
      ["grep", "version", "HEAD"],
      ["base", "main"],
    ];
    for (const form of forms) {
      const r = await gitRead(form, dir);
      assertEquals(r.code, 0, `git-read ${form.join(" ")}: ${r.stderr}`);
      assert(r.stdout.length > 0, `git-read ${form.join(" ")} printed nothing`);
      assertEquals(await p.ran(), [], `git-read ${form.join(" ")} ran a planted program`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
    await p.remove();
  }
});
