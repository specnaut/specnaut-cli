import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import { ListPendingReconciliationsUseCase } from "../../src/application/reconcile_path.ts";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import { fakeStagingStore } from "./upgrade_fakes.ts";

/**
 * A staged name comes from the repository's staging tree, and the lines that
 * name it reach the user's terminal, or the JSON the review walk shows verbatim
 * (cli#776): each shows the name through `terminalText`.
 */

// deno-lint-ignore no-control-regex
const RAW = /[\x00-\x08\x0b-\x1f\x7f-\x9f‮]/;
const [LINKED, BUSY] = ["a\x1b[2J.md", "b\x9b‮.md"];

Deno.test("pruneStaging's lines show a staged name and an error escaped", async () => {
  const store = fakeStagingStore([LINKED, BUSY]);
  store.delete = (_d, rel) =>
    Promise.reject(rel === LINKED ? new PathRefusal("refused") : new Error(`EBUSY ${rel}`));
  const lines = await pruneStaging(store, "/p", new Set());
  assertEquals(lines.length, 2);
  for (const line of lines) assert(!RAW.test(line), JSON.stringify(line));
  assertStringIncludes(lines[0], "a\\u001b[2J.md");
  assertStringIncludes(lines[1], "b\\u009b\\u202e.md");
});

Deno.test("reconcile --status reports a refused name escaped, in path and reason", async () => {
  const store = fakeStagingStore([LINKED]);
  store.read = () => Promise.reject(new PathRefusal("refused"));
  const lock = { entries: new Map([[LINKED, {}]]) };
  const lockStore = { read: () => Promise.resolve(lock), write: () => Promise.resolve() };
  const { refused } = await new ListPendingReconciliationsUseCase({
    reader: {} as never,
    lockStore: lockStore as never,
    stagingStore: store,
  }).execute("/p");
  assertEquals(refused.length, 1);
  assertEquals(refused[0].path, "a\\u001b[2J.md");
  assert(!RAW.test(refused[0].reason), JSON.stringify(refused[0].reason));
  assertStringIncludes(refused[0].reason, "upgrade-staging/a\\u001b[2J.md");
});
