import { assertEquals, assertStringIncludes } from "@std/assert";
import { constitutionNotices } from "../../src/application/upgrade_constitution_notices.ts";
import { CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { fakeReader } from "./upgrade_fakes.ts";

/**
 * What upgrade says about the constitution it never edits (spec 038): the
 * default principles it lacks (US3) and a size over its ceiling (FR-016).
 */

const BOOT = "## Alpha\n\nCheck: a holds.\n\n## Beta\n\nCheck: b holds.\n";
const none = { kind: "none", bootstrap: false } as const;

Deno.test("names the principles the file at docs/constitution.md lacks", async () => {
  const reader = fakeReader({ [CONSTITUTION_PATH]: "# Ours\n\n## alpha\n" });
  const [notice] = await constitutionNotices(reader, "/p", BOOT, none);
  assertStringIncludes(notice ?? "", `${CONSTITUTION_PATH} lacks the default principles Beta`);
  assertStringIncludes(notice ?? "", "upgrade never edits the file");
});

Deno.test("on a move, judges the moved bytes, not what is on disk yet", async () => {
  const move = { kind: "move", bootstrap: false, content: "Check: B holds." } as const;
  const [notice] = await constitutionNotices(fakeReader({}), "/p", BOOT, move);
  assertStringIncludes(notice ?? "", "principles Alpha —");
});

Deno.test("says nothing when every principle is there, no file is there, or no bootstrap ships", async () => {
  assertEquals(
    await constitutionNotices(fakeReader({ [CONSTITUTION_PATH]: BOOT }), "/p", BOOT, none),
    [],
  );
  assertEquals(await constitutionNotices(fakeReader({}), "/p", BOOT, none), []);
  assertEquals(
    await constitutionNotices(fakeReader({ [CONSTITUTION_PATH]: "# x" }), "/p", undefined, none),
    [],
  );
});

Deno.test("warns when the constitution is over its ceiling, the moved bytes included", async () => {
  const long = BOOT + "- rule\n".repeat(100);
  const onDisk = await constitutionNotices(
    fakeReader({ [CONSTITUTION_PATH]: long }),
    "/p",
    BOOT,
    none,
  );
  assertEquals(onDisk.length, 1);
  assertStringIncludes(onDisk[0], `${CONSTITUTION_PATH} is 107 lines, over its ceiling of 100`);
  const move = { kind: "move", bootstrap: false, content: long } as const;
  assertEquals(await constitutionNotices(fakeReader({}), "/p", undefined, move), onDisk);
});

Deno.test("the ceiling is the config's constitution unit; an unreadable config is said, not defaulted", async () => {
  const long = BOOT + "- rule\n".repeat(100);
  const roomy = "constitution:\n  target: 150\n  ceiling: 200\n";
  assertEquals(
    await constitutionNotices(
      fakeReader({ [CONSTITUTION_PATH]: long, [SIZE_LIMITS_CONFIG_PATH]: roomy }),
      "/p",
      BOOT,
      none,
    ),
    [],
  );
  const tight = "constitution:\n  target: 2\n  ceiling: 3\n";
  const [over] = await constitutionNotices(
    fakeReader({ [CONSTITUTION_PATH]: BOOT, [SIZE_LIMITS_CONFIG_PATH]: tight }),
    "/p",
    BOOT,
    none,
  );
  assertStringIncludes(over ?? "", "over its ceiling of 3");
  const [bad] = await constitutionNotices(
    fakeReader({ [CONSTITUTION_PATH]: long, [SIZE_LIMITS_CONFIG_PATH]: "file: {}\n" }),
    "/p",
    BOOT,
    none,
  );
  assertStringIncludes(bad ?? "", `${SIZE_LIMITS_CONFIG_PATH} is unreadable (line 1:`);
  assertEquals(
    (bad ?? "").includes("over its ceiling"),
    false,
    "never judged against the defaults",
  );
});
