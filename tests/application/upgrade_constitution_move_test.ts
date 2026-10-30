import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { executeConstitutionMove } from "../../src/application/upgrade_constitution_move.ts";
import { ReadFault } from "../../src/application/read_fault.ts";
import { LEGACY_CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import { fakeReader, fakeWriter } from "./upgrade_fakes.ts";

/**
 * cli#704: only the filesystem's own refusal (`ReadFault`) is "cannot be read".
 * Every other throw — a containment refusal above all — surfaces as itself,
 * because "make it readable" is wrong advice for a link that leaves the project.
 */

const LEAVES = "refusing to touch a path that leaves the project";

/** A reader whose `readEntry` throws `err` at `LEGACY_CONSTITUTION_PATH`. */
function throwingAtLegacy(err: Error) {
  const base = fakeReader({});
  return {
    ...base,
    readEntry: (d: string, rel: string) =>
      rel === LEGACY_CONSTITUTION_PATH ? Promise.reject(err) : base.readEntry(d, rel),
  };
}

const run = (err: Error) =>
  executeConstitutionMove({
    reader: throwingAtLegacy(err),
    writer: fakeWriter(),
    projectDir: "/p",
    dryRun: false,
  });

Deno.test("a read fault is a refusal that says the file cannot be read", async () => {
  const out = await run(new ReadFault("Permission denied (os error 13)"));
  assertEquals(out.verdict.kind, "refuse-unreadable");
  assertStringIncludes(out.notes.join("\n"), `${LEGACY_CONSTITUTION_PATH} cannot be read`);
});

Deno.test("a containment refusal surfaces as itself, never as 'cannot be read'", async () => {
  const err = await assertRejects(() => run(new Error(`${LEAVES}:\n  path: /p/x`)), Error);
  assertStringIncludes(err.message, LEAVES);
  assert(!err.message.includes("cannot be read"), err.message);
});
