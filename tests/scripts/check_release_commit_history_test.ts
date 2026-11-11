import { assert, assertEquals } from "@std/assert";
import { git, H, LEAD, repoAt, repoWithHighlights, run } from "./release_commit_fixture.ts";

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
async function releaseRecording(record: string | null): Promise<string> {
  return await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async (d) => {
    await Deno.writeTextFile(`${d}/${H}`, NEW);
    await git(d, "add", "-A");
    await git(d, "commit", "-q", "-m", "docs(release): the new lead");
  }, record);
}

Deno.test("a release commit whose history file equals its highlights passes", async () => {
  assertEquals((await run(await releaseRecording(NEW), "v1.1.0")).code, 0);
});

Deno.test("a release commit with no history file is refused", async () => {
  const { code, err } = await run(await releaseRecording(null), "v1.1.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v1.1.0")} is missing`), err);
});

Deno.test("a history file that differs from the highlights is refused", async () => {
  const { code, err } = await run(await releaseRecording(LEAD), "v1.1.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v1.1.0")} differs from ${H}`), err);
});

Deno.test("a history file that only reflows the highlights passes", async () => {
  const reflowed = NEW.replace(" And here", "\nAnd here").replace("\n\n", "\n \n");
  assertEquals((await run(await releaseRecording(reflowed), "v1.1.0")).code, 0);
});

Deno.test("a release with no highlights records an empty history file", async () => {
  const dir = await repoAt("3.0.0", "chore: release v3.0.0");
  assertEquals(await Deno.readTextFile(`${dir}/${historyOf("v3.0.0")}`), "");
  assertEquals((await run(dir, "v3.0.0")).code, 0);
  await Deno.remove(`${dir}/${historyOf("v3.0.0")}`);
  await git(dir, "commit", "-qam", "chore: release v3.0.0");
  const { code, err } = await run(dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes(`${historyOf("v3.0.0")} is missing`), err);
});
