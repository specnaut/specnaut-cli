import { assert, assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import type { FsReader } from "../../src/application/ports.ts";
import { gatherPlanInputs } from "../../src/application/upgrade_plan_inputs.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { wrapInBlock } from "../../src/domain/merge_block.ts";
import type { Bundle } from "../../src/domain/template.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { fakeReader, fakeWriter } from "./upgrade_fakes.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
} from "../../src/domain/constitution_paths.ts";

/**
 * What the upgrade plan is computed from (spec 038 extracted it from
 * `UpgradeProjectUseCase.execute`). The case that matters: a refused dest
 * leaves the bundle AND the lock — left in the lock alone, it is an orphan the
 * next plan deletes (cli#599).
 */

const REFUSAL = { pattern: "^\\[agents\\]", message: "add the agent keys by hand" };
const entry = { sha256: "old", installedAt: "2026-01-01T00:00:00Z", templatesVersion: "7.0.0" };
const io = (reader: ReturnType<typeof fakeReader>, dryRun = false) => ({
  reader,
  writer: fakeWriter(),
  dryRun,
});
const lockOf = (...dests: string[]): InstalledLock => ({
  version: 2,
  harness: "codex",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "7.0.0",
  entries: new Map(dests.map((d) => [d, entry])),
});

Deno.test("a refused merge leaves the bundle, the lock and the disk state", async () => {
  const planned: Bundle = {
    "config.toml": { content: "a = 1", executable: false, mergeBlock: "x", mergeRefuseIf: REFUSAL },
    "a.md": { content: "alpha", executable: false },
  };
  const inputs = await gatherPlanInputs(
    io(fakeReader({ "config.toml": "[agents]\nmax = 2\n", "a.md": "alpha" })),
    "/p",
    planned,
    lockOf("config.toml", "a.md"),
    () => false,
  );
  assertEquals(inputs.refusals, [REFUSAL.message]);
  assertEquals(Object.keys(inputs.bundle), ["a.md"]);
  assertEquals([...inputs.lockForPlan.entries.keys()], ["a.md"], "a refused dest became an orphan");
  assertEquals([...inputs.diskShas.keys()], ["a.md"]);
  assertEquals(inputs.diskShas.get("a.md"), await sha256Hex("alpha"));
  assertEquals(Object.keys(planned), ["config.toml", "a.md"], "the caller's bundle was mutated");
});

Deno.test("nothing refused: the lock is planned against as it is", async () => {
  const lock = lockOf("a.md");
  const inputs = await gatherPlanInputs(
    io(fakeReader({ "a.md": "alpha" })),
    "/p",
    { "a.md": { content: "alpha", executable: false } },
    lock,
    () => false,
  );
  assertStrictEquals(inputs.lockForPlan, lock);
  assertEquals(inputs.refusals, []);
});

Deno.test("a merge-block file is hashed by its block, never the user's whole file", async () => {
  const disk = `# the user's own line\n${wrapInBlock("a = 1", "x")}\n`;
  const inputs = await gatherPlanInputs(
    io(fakeReader({ "config.toml": disk })),
    "/p",
    { "config.toml": { content: "a = 1", executable: false, mergeBlock: "x" } },
    lockOf("config.toml"),
    () => false,
  );
  assertEquals(inputs.diskShas.get("config.toml"), await sha256Hex("a = 1"));
});

Deno.test("the legacy constitution leaves the bundle and the lock in every mode (A-M1, A-H3)", async () => {
  for (const dryRun of [false, true]) {
    for (
      const disk of [{ [LEGACY_CONSTITUTION_PATH]: "ours" } as Record<string, string>, {
        [LEGACY_CONSTITUTION_PATH]: "ours",
        [CONSTITUTION_PATH]: "theirs",
      }]
    ) {
      const inputs = await gatherPlanInputs(
        io(fakeReader({ ...disk, "a.md": "alpha" }), dryRun),
        "/p",
        {
          [CONSTITUTION_PATH]: { content: "bootstrap", executable: false, skipIfExists: true },
          "a.md": { content: "alpha", executable: false },
        },
        lockOf(LEGACY_CONSTITUTION_PATH, "a.md"),
        () => false,
      );
      assertEquals(Object.keys(inputs.bundle), ["a.md"], "the default would shadow the old file");
      assertEquals([...inputs.lockForPlan.entries.keys()], ["a.md"], "the old file is an orphan");
      assertEquals([...inputs.diskShas.keys()], ["a.md"]);
      assert(
        inputs.refusals.some((n) => n.startsWith(LEGACY_CONSTITUTION_PATH)),
        "the move is said",
      );
    }
  }
});

Deno.test("an unreadable constitution, at either address, is refused — never an abort", async () => {
  const denied = () => Promise.reject(new Deno.errors.PermissionDenied("Permission denied"));
  for (const unreadable of [LEGACY_CONSTITUTION_PATH, CONSTITUTION_PATH]) {
    const base = fakeReader({ [LEGACY_CONSTITUTION_PATH]: "ours", "a.md": "alpha" });
    const reader: FsReader = {
      readText: (d, r) => r === unreadable ? denied() : base.readText(d, r),
      readEntry: (d, r) => r === unreadable ? denied() : base.readEntry(d, r),
    };
    const writer = fakeWriter();
    const inputs = await gatherPlanInputs(
      { reader, writer, dryRun: false },
      "/p",
      {
        [CONSTITUTION_PATH]: { content: "bootstrap", executable: false, skipIfExists: true },
        "a.md": { content: "alpha", executable: false },
      },
      lockOf(LEGACY_CONSTITUTION_PATH, "a.md"),
      () => false,
    );
    assertEquals(Object.keys(inputs.bundle), ["a.md"], unreadable);
    assertEquals([...inputs.lockForPlan.entries.keys()], ["a.md"], unreadable);
    assertEquals(writer.written.size, 0, unreadable);
    assertEquals(inputs.refusals.length, 1, inputs.refusals.join("\n"));
    assertStringIncludes(inputs.refusals[0], `${unreadable} cannot be read`);
  }
});
