import { assert, assertStringIncludes } from "@std/assert";

/**
 * `reconcile --status` lists, in `refused`, the staged links no command may act
 * on (cli#765). The upgrade walk is what a user sees, so the bundled guidance
 * must read that list and show it (cli#776), or the user never learns of them.
 */

const read = (rel: string) =>
  Deno.readTextFile(new URL(`../../templates/core/${rel}`, import.meta.url));

/** The text from `heading` to the next heading of the same level. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  assert(start >= 0, `missing: ${heading}`);
  const next = doc.indexOf("\n### ", start + heading.length);
  return doc.slice(start, next < 0 ? undefined : next);
}

Deno.test("the guide's reconcile step reads `refused` and shows each refused link", async () => {
  const step = section(await read("agents/specnaut-guide.md"), "### 6. Reconcile customized files");
  assertStringIncludes(step, "`refused`");
  assertStringIncludes(step, "`reason`");
});

Deno.test("specnaut-facts says `reconcile --status` lists refused links to show the user", async () => {
  const facts = await read("skills/specnaut-facts/SKILL.md");
  const line = facts.split("\n").find((l) => l.startsWith("- `specnaut reconcile --status`"));
  assert(line !== undefined);
  assertStringIncludes(line, "`refused`");
});
