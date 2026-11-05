import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { count, fixtureRepo, git, gitRun, scope } from "./collect_audit_scope_fixture.ts";

/**
 * `collect-audit-scope.sh` runs git inside a repository nobody vetted (#747).
 * Two of git's own features would let that repository act through it: a
 * `core.fsmonitor` value names a program git runs on an index read, a
 * `gpg.program` is run to verify a signed commit when `log.showSignature` is
 * on, and pathspec magic turns a `--path` into a pattern. The script turns all
 * three off on every git call; these cases plant each one, show an unguarded
 * git running it (the control), and watch the script leave it inert.
 */

/** A program that leaves `<dir>/ran` behind when run, and the marker's path. */
async function plantHook(dir: string): Promise<{ hook: string; marker: string }> {
  const hook = `${dir}/hook.sh`;
  await Deno.writeTextFile(hook, `#!/bin/sh\ntouch "${dir}/ran"\nexit 1\n`);
  await Deno.chmod(hook, 0o755);
  return { hook, marker: `${dir}/ran` };
}

/** A commit carrying a `gpgsig` header on top of HEAD, so `git log` has a signature to verify. */
async function signedCommit(dir: string): Promise<void> {
  const tree = (await git(["rev-parse", "HEAD^{tree}"], dir)).trim();
  const parent = (await git(["rev-parse", "HEAD"], dir)).trim();
  const who = "Test <test@example.com> 1700000000 +0000";
  const sig = " -----BEGIN PGP SIGNATURE-----\n \n iQEzBAABCAAdFiEE\n -----END PGP SIGNATURE-----";
  const body = `tree ${tree}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n` +
    `gpgsig${sig}\n\nchore: a signed commit\n`;
  const sha = (await git(["hash-object", "-t", "commit", "-w", "--stdin"], dir, body)).trim();
  await git(["update-ref", "refs/heads/main", sha], dir);
}

/** The control step: an unguarded git runs the hook, or the case below proves nothing. */
async function assertHookLive(dir: string, marker: string, args: string[]): Promise<void> {
  const probe = await gitRun(args, dir);
  assert(await exists(marker), `the planted hook must be live (git ${args[0]}: ${probe.stderr})`);
  await Deno.remove(marker);
}

Deno.test("collect-audit-scope never runs the program core.fsmonitor names", async () => {
  const dir = await fixtureRepo();
  const outside = await Deno.makeTempDir({ prefix: "fsmonitor-marker-" });
  try {
    const { hook, marker } = await plantHook(outside);
    await git(["config", "core.fsmonitor", hook], dir);
    await assertHookLive(dir, marker, ["status"]);
    const r = await scope(dir, ["--path", "src"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: path", "the path scope must have run git ls-files");
    assert(!(await exists(marker)), "git ran the repository's fsmonitor hook");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("collect-audit-scope never verifies a signature with the gpg.program a repo names", async () => {
  const dir = await fixtureRepo();
  const outside = await Deno.makeTempDir({ prefix: "gpg-marker-" });
  try {
    const { hook, marker } = await plantHook(outside);
    await signedCommit(dir);
    await git(["config", "gpg.program", hook], dir);
    await git(["config", "log.showSignature", "true"], dir);
    await assertHookLive(dir, marker, ["log", "--oneline", "-n", "2"]);
    const r = await scope(dir, ["--last", "2"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "chore: a signed commit", "the scope must have run git log");
    assert(!(await exists(marker)), "git ran the repository's gpg.program");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("collect-audit-scope reads --path literally, never as a pathspec pattern", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--path", "*.json"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: path");
    assertEquals(count(r.stdout, "TOTAL_FILES"), 0, "`*.json` matched deno.json as a glob");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
