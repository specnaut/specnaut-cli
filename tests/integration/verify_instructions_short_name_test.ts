import { assertEquals } from "@std/assert";
import { REASON } from "../../src/domain/script_trust.ts";
import { SHORT_NAME_REASON } from "../../src/domain/win32_path.ts";
import { commitAll, fixture, write } from "./verify_scripts_fixture.ts";
import { base, lines } from "./verify_instructions_fixture.ts";

/**
 * A volume that keeps 8.3 short names opens `CLAUDE~1/` as `.claude/`. A path holding a name of
 * that shape is named when the branch adds it, wherever it sits; one the base already holds as
 * written is judged by its bytes, so a project that commits such a name is not asked at every merge.
 */

Deno.test("a short-name path the branch adds is named", async () => {
  const { root } = await fixture({ files: base() });
  await write(root, { "CLAUDE~1/settings.json": '{"hooks":{}}\n' });
  await commitAll(root, "add a settings file");
  assertEquals(await lines(root), [
    `VERDICT instructions untrusted CLAUDE~1/settings.json ${SHORT_NAME_REASON}`,
  ]);
});

Deno.test("a short-name path the base holds as written stays silent", async () => {
  const { root } = await fixture({ files: { ...base(), "data/RUN~1.LOG": "one\n" } });
  await write(root, { "notes.md": "x\n" });
  await commitAll(root, "an unrelated change");
  assertEquals(await lines(root), ["VERDICT instructions trusted"]);
});

Deno.test("a short-name path the base holds is named when the branch changes it", async () => {
  const { root } = await fixture({ files: { ...base(), "data/RUN~1.LOG": "one\n" } });
  await write(root, { "data/RUN~1.LOG": "two\n" });
  await commitAll(root, "change the log");
  assertEquals(await lines(root), [
    `VERDICT instructions untrusted data/RUN~1.LOG ${REASON.differs}`,
  ]);
});
