import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git } from "./collect_audit_scope_fixture.ts";
import {
  gitRead,
  libraryGit,
  plainGit,
  Plants,
  signedCommit,
  slash,
  twoCommitRepo,
} from "./git_read_fixture.ts";

/**
 * `git-read.sh` and the library behind it read a repository whose configuration
 * nobody vetted. Each case plants one program the configuration can name, shows
 * plain git running it (the control), then runs the library and finds it unrun.
 */

async function withPlants(fn: (dir: string, p: Plants) => Promise<void>): Promise<void> {
  const dir = await twoCommitRepo();
  const p = await Plants.create();
  try {
    await fn(dir, p);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await p.remove();
  }
}

Deno.test("git-read leaves a configured fsmonitor program unrun", () =>
  withPlants(async (dir, p) => {
    await git(["config", "core.fsmonitor", await p.plant("fsmonitor")], dir);
    await plainGit(["ls-files"], dir);
    assertEquals(await p.ran(), ["fsmonitor"], "the planted program must be live");
    const r = await gitRead(["files"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "notes.txt", "the files form must have listed the index");
    assertEquals(await p.ran(), []);
  }));

Deno.test("git-read leaves a configured textconv program unrun", () =>
  withPlants(async (dir, p) => {
    await Deno.writeTextFile(`${dir}/.gitattributes`, "*.txt diff=conv\n");
    await git(["config", "diff.conv.textconv", await p.plant("textconv")], dir);
    await plainGit(["diff", "HEAD~1", "HEAD"], dir);
    assertEquals(await p.ran(), ["textconv"], "the planted program must be live");
    const r = await gitRead(["patch", "HEAD~1", "HEAD", "notes.txt"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "+version 2", "the patch form must have diffed the file");
    assertEquals(await p.ran(), []);
  }));

Deno.test("git-read leaves a configured external diff program unrun", () =>
  withPlants(async (dir, p) => {
    await Deno.writeTextFile(`${dir}/.gitattributes`, "*.bin diff=ext\n");
    await git(["config", "diff.ext.command", await p.plant("external-diff")], dir);
    await plainGit(["diff", "HEAD~1", "HEAD"], dir);
    assertEquals(await p.ran(), ["external-diff"], "the planted program must be live");
    const r = await gitRead(["patch", "HEAD~1", "HEAD", "data.bin"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "+bytes 2", "the patch form must have diffed the file");
    assertEquals(await p.ran(), []);
  }));

/** One row per key git reads a signature program from, with the signature kind it serves. */
const SIGNATURE_PROGRAMS = [
  ["gpg.program", "openpgp"],
  ["gpg.openpgp.program", "openpgp"],
  ["gpg.ssh.program", "ssh"],
  ["gpg.x509.program", "x509"],
] as const;

for (const [key, kind] of SIGNATURE_PROGRAMS) {
  Deno.test(`the git library leaves a configured ${key} unrun, even when a caller asks for %G?`, () =>
    withPlants(async (dir, p) => {
      await signedCommit(dir, kind);
      await git(["config", key, await p.plant(key)], dir);
      if (kind === "ssh") {
        await Deno.writeTextFile(`${p.dir}/allowed`, "");
        await git(["config", "gpg.ssh.allowedSignersFile", slash(`${p.dir}/allowed`)], dir);
      }
      const args = ["log", "-1", "--format=%G?", `signed-${kind}`];
      await plainGit(args, dir);
      assertEquals(await p.ran(), [key], "the planted program must be live");
      const r = await libraryGit(args, dir);
      assertEquals(r.code, 0, r.stderr);
      assertEquals(await p.ran(), []);
    }));
}

Deno.test("git-read verifies no signature when the repository asks for one in every log", () =>
  withPlants(async (dir, p) => {
    await signedCommit(dir, "openpgp");
    await git(["config", "gpg.program", await p.plant("gpg")], dir);
    await git(["config", "log.showSignature", "true"], dir);
    await git(["config", "format.pretty", "format:%G? %s"], dir);
    await plainGit(["log", "-1", "signed-openpgp"], dir);
    assertEquals(await p.ran(), ["gpg"], "the planted program must be live");
    for (const args of [["log", "signed-openpgp", "1"], ["show", "signed-openpgp", "--no-patch"]]) {
      const r = await gitRead(args, dir);
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stdout, "chore: a openpgp signed commit", `${args[0]} must have run`);
      assertEquals(await p.ran(), [], `git-read ${args.join(" ")}`);
    }
  }));

Deno.test("the git library leaves a configured hooks directory unused", () =>
  withPlants(async (dir, p) => {
    await p.plant("reference-transaction", `${p.dir}/reference-transaction`);
    await git(["config", "core.hooksPath", slash(p.dir)], dir);
    await plainGit(["update-ref", "refs/heads/probe-plain", "HEAD"], dir);
    assertEquals(await p.ran(), ["reference-transaction"], "the planted hook must be live");
    const r = await libraryGit(["update-ref", "refs/heads/probe-library", "HEAD"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await p.ran(), []);
  }));

Deno.test("git-read reads the repository it runs in, whatever GIT_DIR the caller exported", async () => {
  const dir = await twoCommitRepo();
  const other = await Deno.makeTempDir({ prefix: "git-read-other-" });
  try {
    await git(["init", "-b", "main"], other);
    await Deno.writeTextFile(`${other}/elsewhere.txt`, "x\n");
    await git(["add", "."], other);
    await git(["commit", "-m", "chore: elsewhere"], other);
    const env = { GIT_DIR: slash(`${other}/.git`) };
    const control = await plainGit(["ls-files"], dir, env);
    assertStringIncludes(control.stdout, "elsewhere.txt", "the exported GIT_DIR must be live");
    const r = await gitRead(["files"], dir, env);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "notes.txt");
    assert(!r.stdout.includes("elsewhere.txt"), `read the exported GIT_DIR:\n${r.stdout}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});

Deno.test("git-read reads a path literally, never as a pathspec pattern", () =>
  withPlants(async (dir) => {
    const control = await plainGit(["ls-files", "--", "*.json"], dir);
    assertStringIncludes(control.stdout, "deno.json", "the pattern must match as a glob");
    const r = await gitRead(["files", "*.json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, "", "`*.json` matched deno.json as a glob");
  }));

Deno.test("git-read grep reads the revision it is given, not the work tree", () =>
  withPlants(async (dir) => {
    const worktree = await plainGit(["grep", "-F", "-e", "version 1"], dir);
    assertEquals(worktree.stdout, "", "the text must exist only at the older revision");
    const r = await gitRead(["grep", "version 1", "HEAD~1"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, "HEAD~1:notes.txt:1:version 1\n");
  }));

Deno.test("git-read hands a grep pattern to git as a pattern, never as an option", () =>
  withPlants(async (dir, p) => {
    // `-f <file>` would read the patterns from a file outside the tree.
    await Deno.writeTextFile(`${p.dir}/patterns`, "version\n");
    const option = `-f${slash(`${p.dir}/patterns`)}`;
    const control = await plainGit(["grep", option, "HEAD"], dir);
    assertStringIncludes(control.stdout, "version 2", "the option must be live");
    const r = await gitRead(["grep", option, "HEAD"], dir);
    assertEquals(r.code, 1, `a pattern that matches nothing: ${r.stderr}`);
    assertEquals(r.stdout, "");
  }));
