import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
  SIZE_LIMITS_CONFIG_PATH,
} from "../../src/domain/constitution_paths.ts";
import { checkConstitution } from "../../src/infrastructure/fs_constitution_check.ts";

/** The `check --project` constitution row (spec 038): read at docs/constitution.md, held to its ceiling. */

async function withFiles(files: Record<string, string>, fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-constitution-check-" });
  try {
    for (const [rel, text] of Object.entries(files)) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, rel), text);
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("reads docs/constitution.md, never the legacy path", async () => {
  await withFiles({ [LEGACY_CONSTITUTION_PATH]: "- rule\n" }, async (dir) => {
    assertEquals(await checkConstitution(dir), {
      name: "constitution",
      status: "fail",
      message: "missing docs/constitution.md — run 'specnaut upgrade'",
    });
  });
});

Deno.test("passes a populated constitution, warns on a placeholder", async () => {
  await withFiles({ [CONSTITUTION_PATH]: "- rule\n" }, async (dir) => {
    assertEquals((await checkConstitution(dir)).status, "pass");
  });
  await withFiles({ [CONSTITUTION_PATH]: "(none defined yet)\n" }, async (dir) => {
    assertEquals((await checkConstitution(dir)).status, "warn");
  });
});

Deno.test("warns when the constitution is over its ceiling (FR-016)", async () => {
  await withFiles({ [CONSTITUTION_PATH]: "- rule\n".repeat(101) }, async (dir) => {
    const outcome = await checkConstitution(dir);
    assertEquals(outcome.status, "warn");
    assertEquals(outcome.message.startsWith("docs/constitution.md is 101 lines"), true);
  });
});

Deno.test("the ceiling comes from .specnaut/size-limits.yml; an unreadable one warns", async () => {
  const text = "# C\n" + "- rule\n".repeat(120);
  const roomy = "constitution:\n  target: none\n  ceiling: none\n";
  await withFiles({ [CONSTITUTION_PATH]: text, [SIZE_LIMITS_CONFIG_PATH]: roomy }, async (dir) => {
    assertEquals((await checkConstitution(dir)).status, "pass");
  });
  await withFiles(
    { [CONSTITUTION_PATH]: "# C\n", [SIZE_LIMITS_CONFIG_PATH]: "\tfile:\n" },
    async (dir) => {
      const outcome = await checkConstitution(dir);
      assertEquals(outcome.status, "warn");
      assertEquals(outcome.message.startsWith(`${SIZE_LIMITS_CONFIG_PATH} is unreadable`), true);
    },
  );
});
