import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { filterInitBundle } from "../../src/application/init_bundle_filter.ts";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import { ReadFault } from "../../src/application/read_fault.ts";
import type { FsReader } from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { fakeReader, fakeWriter } from "./upgrade_fakes.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
} from "../../src/domain/constitution_paths.ts";

const io = (reader: FsReader | undefined, dryRun = false) => ({
  reader,
  writer: fakeWriter(),
  dryRun,
});

/**
 * What `init` writes (spec 038 extracted it from `InitProjectUseCase.execute`):
 * preserved dests are held back from the write, a merge the host file cannot
 * take is refused and said (cli#599), and a reader that cannot see the target
 * yet never makes init fail.
 */

const REFUSAL = { pattern: "^\\[agents\\]", message: "add the agent keys by hand" };
const bundle: Bundle = {
  "config.toml": { content: "a = 1", executable: false, mergeBlock: "x", mergeRefuseIf: REFUSAL },
  "a.md": { content: "alpha", executable: false },
  "kept.md": { content: "kept", executable: false },
};

Deno.test("preserved and refused dests are held back; the rest is written", async () => {
  const r = await filterInitBundle(
    io(fakeReader({ "config.toml": "[agents]\n" })),
    "/p",
    bundle,
    new Set(["kept.md", "not-in-bundle.md"]),
  );
  assertEquals(Object.keys(r.bundleToWrite), ["a.md"]);
  assertEquals(r.preserved, ["kept.md"]);
  assertEquals(r.refusals, [REFUSAL.message]);
});

Deno.test("a host file that can take the block is merged into", async () => {
  const r = await filterInitBundle(
    io(fakeReader({ "config.toml": "a = 0\n" })),
    "/p",
    bundle,
    new Set(),
  );
  assertEquals(Object.keys(r.bundleToWrite), ["config.toml", "a.md", "kept.md"]);
  assertEquals(r.refusals, []);
});

/**
 * A reader that fails at `rel` as the real one does: a refusal from both reads,
 * and a filesystem error raw from `readText`, wrapped as a `ReadFault` by
 * `readEntry` alone (cli#704).
 */
const failing = (err: Error, rel: string): FsReader => {
  const base = fakeReader({});
  const asEntry = err instanceof PathRefusal ? err : new ReadFault(err.message, { cause: err });
  return {
    readText: (d, r) => r === rel ? Promise.reject(err) : base.readText(d, r),
    readEntry: (d, r) => r === rel ? Promise.reject(asEntry) : base.readEntry(d, r),
    listFiles: base.listFiles,
  };
};
const denied = () => new Deno.errors.PermissionDenied("Permission denied (os error 13)");

Deno.test("no reader, or nothing on disk yet, refuses nothing", async () => {
  // The reader says "nothing there" for a target directory not created yet.
  for (const reader of [undefined, fakeReader({})]) {
    const r = await filterInitBundle(io(reader), "/p", bundle, new Set());
    assertEquals(Object.keys(r.bundleToWrite).length, 3);
    assertEquals(r.refusals, []);
  }
});

Deno.test("the legacy constitution moves, and both its paths are held back from write and lock", async () => {
  const withDefault: Bundle = {
    ...bundle,
    [CONSTITUTION_PATH]: { content: "bootstrap", executable: false, skipIfExists: true },
  };
  for (const dryRun of [false, true]) {
    const writer = fakeWriter();
    const r = await filterInitBundle(
      { reader: fakeReader({ [LEGACY_CONSTITUTION_PATH]: "ours" }), writer, dryRun },
      "/p",
      withDefault,
      new Set(),
    );
    assertEquals(Object.keys(r.bundleToWrite), ["config.toml", "a.md", "kept.md"]);
    assertEquals([...r.excluded], [LEGACY_CONSTITUTION_PATH, CONSTITUTION_PATH]);
    assertEquals(writer.written.get(CONSTITUTION_PATH), dryRun ? undefined : "ours");
    assert(r.refusals.some((n) => n.startsWith(LEGACY_CONSTITUTION_PATH)), "the move is said");
  }
});

Deno.test("no legacy constitution: nothing is held back", async () => {
  const r = await filterInitBundle(io(fakeReader({})), "/p", bundle, new Set());
  assertEquals(r.excluded.size, 0);
});

Deno.test("an unreadable legacy constitution is refused, and the default never shadows it", async () => {
  const withDefault: Bundle = {
    ...bundle,
    [CONSTITUTION_PATH]: { content: "bootstrap", executable: false, skipIfExists: true },
  };
  for (const dryRun of [false, true]) {
    const writer = fakeWriter();
    const r = await filterInitBundle(
      { reader: failing(denied(), LEGACY_CONSTITUTION_PATH), writer, dryRun },
      "/p",
      withDefault,
      new Set(),
    );
    assertEquals(Object.keys(r.bundleToWrite), ["config.toml", "a.md", "kept.md"]);
    assertEquals([...r.excluded], [LEGACY_CONSTITUTION_PATH, CONSTITUTION_PATH]);
    assertEquals(writer.written.size, 0);
    assertEquals(r.refusals.length, 1);
    assertStringIncludes(r.refusals[0], `${LEGACY_CONSTITUTION_PATH} cannot be read`);
    assertStringIncludes(r.refusals[0], "Permission denied");
  }
});

Deno.test("a merge host that cannot be read is refused, not merged blind", async () => {
  const r = await filterInitBundle(
    io(failing(denied(), "config.toml")),
    "/p",
    bundle,
    new Set(),
  );
  assertEquals(Object.keys(r.bundleToWrite), ["a.md", "kept.md"]);
  assertEquals(r.refusals.length, 1);
  assertStringIncludes(r.refusals[0], "config.toml cannot be read");
});

Deno.test("a merge host the reader refused says so, and is not told to be made readable", async () => {
  const leaves = "refusing to touch a path that leaves the project";
  const r = await filterInitBundle(
    io(failing(new PathRefusal(leaves), "config.toml")),
    "/p",
    bundle,
    new Set(),
  );
  // Held back like an unreadable host: the refusal changes the words, not the outcome.
  assertEquals(Object.keys(r.bundleToWrite), ["a.md", "kept.md"]);
  assertEquals(r.refusals.length, 1);
  assertStringIncludes(r.refusals[0], "config.toml was refused");
  assertStringIncludes(r.refusals[0], leaves);
  assert(!r.refusals[0].includes("cannot be read"), r.refusals[0]);
  assert(!r.refusals[0].includes("make it readable"), r.refusals[0]);
});
