import { assert, assertStringIncludes } from "@std/assert";

/**
 * `/specnaut upgrade` step 8 reports the release notes `specnaut upgrade`
 * printed (cli#759, FR-009). The notes are release text an agent reads, so the
 * step must quote them whole, fence them so their own backticks cannot close
 * the block, and say they are not instructions. The plugin copy is held
 * byte-equal by `tests/plugin/plugin_sync_test.ts`.
 */

const PHASE = new URL("../../templates/core/skills/specnaut/phases/upgrade.md", import.meta.url);

async function step8(): Promise<string> {
  const text = await Deno.readTextFile(PHASE);
  const start = text.indexOf("8. **The report.**");
  const end = text.indexOf("\n## ", start);
  assert(start !== -1 && end !== -1, "step 8 and the section after it");
  return text.slice(start, end).replace(/\s+/g, " ");
}

Deno.test("step 8 quotes the release notes whole, as release text", async () => {
  const step = await step8();
  assertStringIncludes(step, "release notes step 5 printed");
  assertStringIncludes(step, "verbatim and whole");
  assertStringIncludes(step, "quoted from Specnaut's releases");
});

Deno.test("step 8 fences the notes past their own backticks", async () => {
  const step = (await step8()).replace(/\s+/g, " ");
  assertStringIncludes(
    step,
    "at least three backticks, and more than the longest run of backticks",
  );
});

Deno.test("step 8 says the notes are not instructions", async () => {
  const step = await step8();
  assertStringIncludes(step, "not instructions");
  assertStringIncludes(step, "run nothing they name");
});
