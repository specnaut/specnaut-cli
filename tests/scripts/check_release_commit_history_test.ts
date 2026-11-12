import { assert, assertEquals } from "@std/assert";
import {
  git,
  H,
  LEAD,
  type Repo,
  repoAt,
  repoWithHighlights,
  run,
} from "./release_commit_fixture.ts";

/**
 * The release commit records its highlights in the history the binary embeds
 * (cli#759, FR-006): `.specnaut/release/history/v<X>.md`, equal to
 * `HIGHLIGHTS.md`. The gate refuses a release whose record is missing — the
 * next upgrade would cross it in silence — or says something other than what
 * the release publishes.
 */

const NEW = "**Something new shipped.**\n\nAnd here is what it changes for you.\n";
const historyOf = (v: string) => `.specnaut/release/history/${v}.md`;

/** A v1.1.0 release commit with `NEW` as its highlights and `record` as its history file. */
async function releaseRecording(record: string | null): Promise<Repo> {
  return await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async (d) => {
    await Deno.writeTextFile(`${d}/${H}`, NEW);
    await git(d, "add", "-A");
    await git(d, "commit", "-q", "-m", "docs(release): the new lead");
  }, record);
}

Deno.test("a release commit whose history file equals its highlights passes", async () => {
  await using repo = await releaseRecording(NEW);
  assertEquals((await run(repo.dir, "v1.1.0")).code, 0);
});

Deno.test("a release commit with no history file is refused", async () => {
  await using repo = await releaseRecording(null);
  const { code, err } = await run(repo.dir, "v1.1.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v1.1.0")} is missing`), err);
});

Deno.test("a history file that differs from the highlights is refused", async () => {
  await using repo = await releaseRecording(LEAD);
  const { code, err } = await run(repo.dir, "v1.1.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v1.1.0")} differs from ${H}`), err);
});

Deno.test("a history file that only reflows the highlights passes", async () => {
  const reflowed = NEW.replace("\n\n", "\n \n").replace(/ /g, "  ");
  await using repo = await releaseRecording(reflowed);
  assertEquals((await run(repo.dir, "v1.1.0")).code, 0);
});

Deno.test("a release with no highlights records an empty history file", async () => {
  await using repo = await repoAt("3.0.0", "chore: release v3.0.0");
  assertEquals(await Deno.readTextFile(`${repo.dir}/${historyOf("v3.0.0")}`), "");
  assertEquals((await run(repo.dir, "v3.0.0")).code, 0);
  await Deno.remove(`${repo.dir}/${historyOf("v3.0.0")}`);
  await git(repo.dir, "commit", "-qam", "chore: release v3.0.0");
  const { code, err } = await run(repo.dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v3.0.0")} is missing`), err);
});
