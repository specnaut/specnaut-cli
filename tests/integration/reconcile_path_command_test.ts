import { assertEquals, assertStringIncludes } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { snapshot } from "../helpers/tree_snapshot.ts";
import {
  EMPTY_SHA,
  LOCK_REL,
  lockOf,
  reconcile,
  STAGING,
  withWork,
} from "./reconcile_command_fixture.ts";

/**
 * `specnaut reconcile <path>` resolves a staged copy, run through `main` as a user's shell runs
 * it (cli#795, from the retired parity scenario `reconcile-path`): what each resolution writes
 * to the project, to the lock and to the staging tree, and that it writes nothing else.
 */

/**
 * The tree after running `args` in `project`, against the tree before with `edits` applied
 * (`null` removes a path). The lock is compared apart, parsed: its text is the serializer's.
 */
async function assertResolves(
  project: string,
  args: string[],
  said: string,
  edits: Record<string, string | null>,
) {
  const expected = await snapshot(project);
  const { code, stdout, stderr } = await reconcile(project, ...args);
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, said);
  for (const [rel, text] of Object.entries(edits)) {
    if (text === null) expected.delete(rel);
    else expected.set(rel, text);
  }
  const after = await snapshot(project);
  for (const tree of [expected, after]) tree.delete(LOCK_REL);
  assertEquals(after, expected);
}

/**
 * The lock re-stamps `rel` with `text`'s digest at the project's templates version, and leaves
 * every other row as planted: still tracked, still the digest of an empty file.
 */
async function assertRestamped(project: string, rel: string, text: string) {
  const lock = await lockOf(project);
  const entry = lock.entries.get(rel);
  assertEquals(entry?.sha256, await sha256Hex(text));
  assertEquals(entry?.templatesVersion, "0.0.1");
  const untouched = [...lock.entries].filter(([other]) => other !== rel);
  assertEquals(untouched.map(([other, row]) => [other, row.sha256]).sort(), [
    ...["a/gone.md", "a/one.md", "a/two.md", "a/unstaged.md"]
      .filter((other) => other !== rel)
      .map((other) => [other, EMPTY_SHA]),
  ]);
}

Deno.test("reconcile <path> --accept-upstream takes the staged copy and backs up the local one", async () => {
  await withWork(async (_work, project) => {
    await assertResolves(project, ["a/one.md", "--accept-upstream"], "reconciled a/one.md", {
      "a/one.md": "upstream one\n",
      "a/one.md.specnaut.bak": "local one\n",
      [`${STAGING}/a/one.md`]: null,
    });
    await assertRestamped(project, "a/one.md", "upstream one\n");
  });
});

Deno.test("reconcile <path> --accept-current keeps the local file and drops the staged copy", async () => {
  await withWork(async (_work, project) => {
    await assertResolves(project, ["a/two.md", "--accept-current"], "reconciled a/two.md", {
      [`${STAGING}/a/two.md`]: null,
    });
    await assertRestamped(project, "a/two.md", "local two\n");
  });
});

Deno.test("reconcile --status lists what reconcile <path> can resolve, before and after", async () => {
  await withWork(async (_work, project) => {
    const status = async () => {
      const { code, stdout, stderr } = await reconcile(project, "--status");
      assertEquals(code, 0, stderr);
      return JSON.parse(stdout);
    };
    const before = await status();
    assertEquals([...before.pending].sort(), ["a/one.md", "a/two.md"]);
    assertEquals(before.stagingDir, STAGING);
    assertEquals(before.refused, []);
    // The scenario's order: both resolutions, then the three refusals.
    await reconcile(project, "a/one.md", "--accept-upstream");
    await reconcile(project, "a/two.md", "--accept-current");
    await reconcile(project, "c/untracked.md", "--accept-upstream");
    await reconcile(project, "a/unstaged.md", "--accept-upstream");
    await reconcile(project, "a/gone.md", "--accept-current");
    // What is left staged is refused by `reconcile <path>`, so it is not pending.
    assertEquals(await status(), { pending: [], stagingDir: null, refused: [] });
  });
});
