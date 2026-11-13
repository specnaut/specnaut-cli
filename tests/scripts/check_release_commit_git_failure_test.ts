import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { hermetic } from "./git_sandbox.ts";
import { git, H, LEAD, repoAt, repoWithHighlights, run } from "./release_commit_fixture.ts";

/**
 * The release gate reads an absent file, or a first release with no tag, as
 * nothing to compare; any other failure is reported, never read as absent. A
 * catch that swallowed every failure let a broken repository pass the gate.
 */

/** Removes the loose object `rev` names, as a damaged repository would lack it. */
async function dropObject(dir: string, rev: string) {
  const out = await new Deno.Command("git", {
    args: ["rev-parse", rev],
    cwd: dir,
    env: hermetic(),
    clearEnv: true,
    stdout: "piped",
  }).output();
  const sha = new TextDecoder().decode(out.stdout).trim();
  await Deno.remove(join(dir, ".git", "objects", sha.slice(0, 2), sha.slice(2)));
}

Deno.test("a previous tag git cannot read is reported, not read as a first release", async () => {
  await using repo = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async () => {});
  await dropObject(repo.dir, "v1.0.0^{commit}");
  const { code, err } = await run(repo.dir, "v1.1.0");
  assertEquals(code, 1, err);
  assert(err.includes("git describe"), err);
});

Deno.test("highlights git cannot read at the previous tag are reported, not read as absent", async () => {
  await using repo = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async () => {});
  await dropObject(repo.dir, "v1.0.0^{tree}");
  const { code, err } = await run(repo.dir, "v1.1.0");
  assertEquals(code, 1, err);
  assert(err.includes("git ls-tree"), err);
});

Deno.test("a highlights file that cannot be read is reported, not read as absent", async () => {
  await using repo = await repoAt("3.0.0", "chore: release v3.0.0");
  await Deno.mkdir(join(repo.dir, H), { recursive: true });
  await Deno.writeTextFile(join(repo.dir, H, "x"), "x\n");
  await git(repo.dir, "add", "-A");
  await git(repo.dir, "commit", "-q", "--amend", "--no-edit");
  const { code, err } = await run(repo.dir, "v3.0.0");
  assertEquals(code, 1, err);
  assert(err.includes(H), err);
});
