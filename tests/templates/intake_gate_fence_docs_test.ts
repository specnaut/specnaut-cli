import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * cli#774 — an INVALID line carries the fence: auto-chain.md asks FR-9's
 * question before the hand fix, and resume reads the working tree's marker
 * narrowly, for the rows that use it.
 */

const T = fromFileUrl(new URL("../../templates/core/skills/task/", import.meta.url));
const read = (p: string) => Deno.readTextFileSync(join(T, p)).replace(/\r\n/g, "\n");
const flat = (s: string) => s.replace(/\s+/g, " ");

Deno.test("a fenced INVALID line is asked about before its hand fix", () => {
  const chain = flat(read("phases/auto-chain.md"));
  assertStringIncludes(chain, "a line ending `fenced` asks the question below first |");
  assertStringIncludes(
    chain,
    "**An `INVALID` line ending `fenced`** gets the same question before",
  );
  assertStringIncludes(chain, "anything else leaves the marker.");
  const resume = flat(read("resume.md"));
  assertStringIncludes(resume, "with the question it asks first when the line ends `fenced`");
});

Deno.test("resume reads only the marker's link, and only for the IDLE rows", () => {
  const resume = flat(read("resume.md"));
  assertStringIncludes(
    resume,
    "for the `IDLE` rows only, the item its `.specnaut/feature.json` links",
  );
  assertStringIncludes(resume, `sed -n 's/.*"linked_issue"`);
  assert(!resume.includes("its `.specnaut/feature.json`, and `git status"), "read whole again");
});
