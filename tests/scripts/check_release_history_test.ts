import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";
import {
  emptyRepo,
  git,
  H,
  HISTORY,
  LEAD,
  type Repo,
  runScript,
  setUp,
} from "./release_commit_fixture.ts";

/**
 * A history record is never edited after its release (cli#775). The release
 * gate compares only the record of the tag being cut, so this check, run in
 * CI, compares every record whose tag exists with `HIGHLIGHTS.md` as that tag
 * published it: whitespace-insensitive, a missing file read as empty.
 */

const SCRIPT = fromFileUrl(new URL("../../scripts/check-release-history.ts", import.meta.url));

function run(cwd: string): Promise<{ code: number; err: string }> {
  return runScript(SCRIPT, cwd);
}

/** A repo whose `v1.0.0` tag published `published` (`null`: no highlights file) and recorded `record`. */
async function released(published: string | null, record: string): Promise<Repo> {
  return await setUp(await emptyRepo("specnaut-history-check-"), async (dir) => {
    await Deno.mkdir(join(dir, HISTORY), { recursive: true });
    if (published !== null) await Deno.writeTextFile(join(dir, H), published);
    await Deno.writeTextFile(join(dir, HISTORY, "v1.0.0.md"), record);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "chore: release v1.0.0");
    await git(dir, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  });
}

/** Rewrites a file in the repo and commits it after the tag. */
async function edit(dir: string, file: string, text: string) {
  await Deno.mkdir(join(dir, file, ".."), { recursive: true });
  await Deno.writeTextFile(join(dir, file), text);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "docs: later edit");
}

Deno.test("a record equal to what its tag published passes, reflowed or not", async () => {
  await using repo = await released(LEAD, LEAD);
  assertEquals((await run(repo.dir)).code, 0);
  await edit(repo.dir, `${HISTORY}/v1.0.0.md`, LEAD.replace(", and", ",\nand"));
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a record edited after its release is refused, naming it and its tag", async () => {
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, `${HISTORY}/v1.0.0.md`, "**Rewritten after the fact.**\n");
  const { code, err } = await run(repo.dir);
  assertEquals(code, 1);
  assert(err.includes(`${HISTORY}/v1.0.0.md`), err);
  assert(err.includes("v1.0.0"), err);
});

Deno.test("HIGHLIGHTS.md rewritten for the next release leaves a past record alone", async () => {
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, H, "**The next lead.**\n");
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a record whose tag does not exist yet is not compared", async () => {
  // The release commit lands before its tag is cut.
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, `${HISTORY}/v1.1.0.md`, "**Not tagged yet.**\n");
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a record whose older tag was deleted is refused; only the release being cut is exempt", async () => {
  // Skipping every untagged record let a deleted tag pass unnoticed.
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, `${HISTORY}/v1.1.0.md`, LEAD);
  await git(repo.dir, "tag", "-a", "v1.1.0", "-m", "v1.1.0");
  await git(repo.dir, "tag", "-d", "v1.0.0");
  const alone = await run(repo.dir);
  assertEquals(alone.code, 1);
  assert(alone.err.includes(`${HISTORY}/v1.0.0.md`) && alone.err.includes("no tag"), alone.err);
  await edit(repo.dir, `${HISTORY}/v1.2.0.md`, "**Being cut.**\n");
  const cut = await run(repo.dir);
  assertEquals(cut.code, 1);
  assert(cut.err.includes(`${HISTORY}/v1.0.0.md`), cut.err);
  assert(!cut.err.includes("v1.2.0"), cut.err);
});

Deno.test("a git failure refuses with git's message, never reads as an absent file", async () => {
  // A tag on a blob makes `<tag>:<path>` fail in git, not resolve as absent:
  // read as absent, the empty record here would pass.
  await using repo = await released(null, "");
  await git(repo.dir, "tag", "-f", "v1.0.0", "HEAD:.specnaut/release/history/v1.0.0.md");
  const { code, err } = await run(repo.dir);
  assertEquals(code, 1);
  // Git's own words, in the C locale the run sets: in German "fatal:" reads "Schwerwiegend:".
  assert(err.includes("git ls-tree") && err.includes("fatal: not a tree object"), err);
});

Deno.test("a git that cannot list the tags refuses with its message", async () => {
  // Outside a repository `git tag` fails; read as no tag, it blamed a shallow fetch.
  const dir = await Deno.makeTempDir({ prefix: "specnaut-history-nogit-" });
  try {
    await Deno.mkdir(join(dir, HISTORY), { recursive: true });
    await Deno.writeTextFile(join(dir, HISTORY, "v1.0.0.md"), LEAD);
    const { code, err } = await run(dir);
    assertEquals(code, 1);
    assert(err.includes("git tag --list") && !err.includes("no v* tag"), err);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a tag that published no highlights file reads as empty", async () => {
  await using empty = await released(null, "");
  assertEquals((await run(empty.dir)).code, 0);
  await using claimed = await released(null, "**Highlights it never published.**\n");
  const { code, err } = await run(claimed.dir);
  assertEquals(code, 1);
  assert(err.includes(`${HISTORY}/v1.0.0.md`), err);
});

Deno.test("records with no tag visible are refused, never passed on nothing", async () => {
  // A shallow CI checkout fetches no tag: without this the check compares nothing and passes.
  await using repo = await released(LEAD, "**Edited.**\n");
  await git(repo.dir, "tag", "-d", "v1.0.0");
  const { code, err } = await run(repo.dir);
  assertEquals(code, 1);
  assert(err.includes("no v* tag"), err);
});

Deno.test("CI fetches the tags, then runs this check on every push", async () => {
  // The checkout is shallow and tagless: a step that ran the check alone would
  // fail on the no-tag guard, and one that skipped it would check nothing.
  type Workflow = { jobs: Record<string, { steps?: Array<{ run?: string }> }> };
  const ci = parse(
    await Deno.readTextFile(
      fromFileUrl(new URL("../../.github/workflows/ci.yml", import.meta.url)),
    ),
  ) as Workflow;
  const runs = Object.values(ci.jobs).flatMap((j) => j.steps ?? []).map((s) => s.run ?? "");
  const step = runs.find((r) => r.includes("scripts/check-release-history.ts"));
  assert(step !== undefined, "ci.yml runs no step calling scripts/check-release-history.ts");
  const fetch = step.indexOf("refs/tags/v*");
  assert(fetch !== -1 && fetch < step.indexOf("scripts/check-release-history.ts"), step);
});
